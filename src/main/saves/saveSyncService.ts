import { rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { ConflictResolution, SyncItemResult, SyncKind, SyncReport } from '../../shared/ipc';
import { LauncherError } from '../errors';
import { writeFileAtomicSync } from '../fs/atomic';
import { log } from '../logging/logger';
import type { DataPaths } from '../paths';
import type { FileUpload, Save, SaveUpload, State } from '../romm/client';
import { NetworkError, RommApiError } from '../romm/errors';
import type { BackupReason, SaveBackups } from './backups';
import { belongsToGame, listLocalFiles, md5, readIfExists } from './localFiles';
import { decideSync, type RemoteFile, type SyncDecision } from './syncDecision';
import type { SyncKey, SyncStore } from './syncStore';

/**
 * The slot other RomM clients use for the save an emulator writes on its own. Using the
 * same one lets a save made elsewhere (for example in RomM's browser player) continue here.
 */
export const SAVE_SLOT = 'autosave';

export interface SyncableRom {
  id: number;
  fs_name: string;
  platform_slug: string;
}

/** The RomM operations the sync engine needs. */
export interface SaveSyncRemote {
  listSaves(romId: number): Promise<Save[]>;
  listStates(romId: number): Promise<State[]>;
  uploadSave(upload: SaveUpload): Promise<Save>;
  downloadSave(id: number, deviceId: string | null): Promise<Buffer>;
  confirmSaveDownloaded(id: number, deviceId: string, contentHash: string): Promise<void>;
  uploadState(upload: FileUpload & { romId: number; emulator: string | null }): Promise<State>;
  replaceState(id: number, upload: FileUpload): Promise<State>;
  downloadState(id: number): Promise<Buffer>;
}

export interface SaveSyncDeps {
  /** Throws when not logged in. */
  getRemote: () => SaveSyncRemote;
  store: SyncStore;
  backups: SaveBackups;
  paths: DataPaths;
  /** Resolves to null when this PC could not be registered; sync still works without. */
  getDeviceId: () => Promise<string | null>;
  now?: () => Date;
}

/** Everything needed to act on one file during a sync run. */
interface FileContext {
  rom: SyncableRom;
  baseName: string;
  key: SyncKey;
  path: string;
  remote: RemoteFile | null;
  emulator: string | null;
  deviceId: string | null;
}

/**
 * Keeps a game's saves and states identical on this PC and on RomM. The same routine runs
 * before launch and after exit: it compares both sides with the record of the last sync
 * and moves whichever side is behind. A local file is always backed up before it is
 * replaced or removed, and a conflict changes nothing until the user picks a side.
 */
export class SaveSyncService {
  constructor(private readonly deps: SaveSyncDeps) {}

  getLastReport(romId: number): SyncReport | null {
    return this.deps.store.getReport(romId);
  }

  /** Never throws: problems are described in the returned report. */
  async syncRom(rom: SyncableRom, emulator: string | null): Promise<SyncReport> {
    const report = await this.buildReport(rom, emulator);
    this.deps.store.saveReport(report);
    log.info(`Save sync for ROM ${rom.id}: ${report.status}`, summarize(report));
    return report;
  }

  async resolveConflict(
    rom: SyncableRom,
    resolution: ConflictResolution,
    emulator: string | null,
  ): Promise<SyncReport> {
    const remote = this.deps.getRemote();
    const baseName = parse(rom.fs_name).name;
    if (!belongsToGame(resolution.fileName, baseName, resolution.kind)) {
      throw new LauncherError('invalid_input', 'That file does not belong to this game.');
    }

    const context: FileContext = {
      rom,
      baseName,
      key: { romId: rom.id, kind: resolution.kind, fileName: resolution.fileName },
      path: join(this.dirFor(rom, resolution.kind), resolution.fileName),
      remote:
        (await this.currentRemoteFiles(remote, rom, baseName, resolution.kind)).get(
          resolution.fileName,
        ) ?? null,
      emulator,
      deviceId: await this.deps.getDeviceId(),
    };

    if (resolution.keep === 'server') {
      if (!context.remote) throw new LauncherError('invalid_input', 'No server copy to keep.');
      await this.download(remote, context, 'conflict-local');
    } else {
      if (context.remote) {
        // Keep the losing server version before it stops being the current one.
        const serverCopy = await this.fetchRemote(remote, context, context.remote);
        await this.deps.backups.backupContent(
          rom.platform_slug,
          baseName,
          serverCopy,
          resolution.fileName,
          'server-copy',
        );
      }
      await this.upload(remote, context, { overwrite: true });
    }
    return this.syncRom(rom, emulator);
  }

  private async buildReport(rom: SyncableRom, emulator: string | null): Promise<SyncReport> {
    const at = (this.deps.now?.() ?? new Date()).toISOString();
    const baseName = parse(rom.fs_name).name;
    const items: SyncItemResult[] = [];
    let offline = false;

    try {
      const remote = this.deps.getRemote();
      const deviceId = await this.deps.getDeviceId();

      for (const kind of ['save', 'state'] as const) {
        const dir = this.dirFor(rom, kind);
        const remoteFiles = await this.currentRemoteFiles(remote, rom, baseName, kind);
        const fileNames = new Set([
          ...(await listLocalFiles(dir, baseName, kind)),
          ...remoteFiles.keys(),
          ...this.deps.store.listFileNames(rom.id, kind),
        ]);

        for (const fileName of [...fileNames].sort()) {
          const context: FileContext = {
            rom,
            baseName,
            key: { romId: rom.id, kind, fileName },
            path: join(dir, fileName),
            remote: remoteFiles.get(fileName) ?? null,
            emulator,
            deviceId,
          };
          const result = await this.syncFile(remote, context);
          offline ||= result.offline;
          items.push(result.item);
        }
      }
    } catch (error) {
      // Listing failed, so nothing was compared and nothing was changed.
      if (error instanceof NetworkError) return { romId: rom.id, status: 'offline', items, at };
      log.warn(`Save sync for ROM ${rom.id} could not start`, error);
      return { romId: rom.id, status: 'error', items, at };
    }

    const status = items.some((item) => item.outcome === 'failed')
      ? offline
        ? 'offline'
        : 'error'
      : items.some((item) => item.outcome === 'conflict')
        ? 'conflict'
        : 'synced';
    return { romId: rom.id, status, items, at };
  }

  private async syncFile(
    remote: SaveSyncRemote,
    context: FileContext,
  ): Promise<{ item: SyncItemResult; offline: boolean }> {
    const { key } = context;
    let decision: SyncDecision = { action: 'none', reason: '' };
    try {
      const content = await readIfExists(context.path);
      decision = decideSync(
        content ? { hash: md5(content) } : null,
        context.remote,
        this.deps.store.getRecord(key),
      );
      const outcome = await this.apply(remote, context, decision);
      return {
        item: {
          kind: key.kind,
          fileName: key.fileName,
          action: decision.action,
          outcome,
          detail: decision.reason,
        },
        offline: false,
      };
    } catch (error) {
      log.warn(`Sync of ${key.fileName} failed`, error);
      const detail = error instanceof Error ? error.message : 'Unexpected error.';
      return {
        item: {
          kind: key.kind,
          fileName: key.fileName,
          action: decision.action,
          outcome: 'failed',
          detail,
        },
        offline: error instanceof NetworkError,
      };
    }
  }

  private async apply(
    remote: SaveSyncRemote,
    context: FileContext,
    decision: SyncDecision,
  ): Promise<SyncItemResult['outcome']> {
    const { store } = this.deps;
    switch (decision.action) {
      case 'none':
        return 'done';

      case 'conflict':
        // Both versions stay exactly where they are until the user picks one.
        return 'conflict';

      case 'upload':
        try {
          await this.upload(remote, context, { overwrite: false });
          return 'done';
        } catch (error) {
          // The server changed between our listing and the upload. Treat it like any other
          // conflict rather than overwriting what another device just saved.
          if (error instanceof RommApiError && error.status === 409) return 'conflict';
          throw error;
        }

      case 'download':
        await this.download(remote, context, 'replaced-by-server');
        return 'done';

      case 'link': {
        const content = await readIfExists(context.path);
        if (content && context.remote) this.record(context, md5(content), context.remote);
        return 'done';
      }

      case 'delete_local':
        await this.backUpLocal(context, 'deleted-on-server');
        await rm(context.path, { force: true });
        store.deleteRecord(context.key);
        return 'done';

      case 'forget':
        store.deleteRecord(context.key);
        return 'done';
    }
  }

  private async upload(
    remote: SaveSyncRemote,
    context: FileContext,
    { overwrite }: { overwrite: boolean },
  ): Promise<void> {
    const content = await readIfExists(context.path);
    if (!content) throw new LauncherError('internal', 'The local file disappeared during sync.');
    const hash = md5(content);
    const { key, rom, emulator, deviceId } = context;
    const file = { fileName: key.fileName, content };

    let uploaded: Save | State;
    if (key.kind === 'save') {
      uploaded = await remote.uploadSave({
        ...file,
        romId: rom.id,
        slot: SAVE_SLOT,
        emulator,
        deviceId,
        contentHash: hash,
        overwrite,
      });
    } else if (context.remote) {
      uploaded = await remote.replaceState(context.remote.id, file);
    } else {
      uploaded = await remote.uploadState({ ...file, romId: rom.id, emulator });
    }

    this.record(context, hash, { id: uploaded.id, updatedAt: uploaded.updated_at });
  }

  private async download(
    remote: SaveSyncRemote,
    context: FileContext,
    backupReason: BackupReason,
  ): Promise<void> {
    if (!context.remote) throw new LauncherError('internal', 'Nothing to download.');
    const content = await this.fetchRemote(remote, context, context.remote);
    const hash = md5(content);

    await this.backUpLocal(context, backupReason);
    writeFileAtomicSync(context.path, content);
    this.record(context, hash, context.remote);

    if (context.key.kind === 'save' && context.deviceId) {
      // Bookkeeping for RomM's device view; the save itself is already safely on disk.
      await remote
        .confirmSaveDownloaded(context.remote.id, context.deviceId, hash)
        .catch((error: unknown) => log.warn('Could not confirm save download', error));
    }
  }

  /** Downloads a remote file and refuses content that does not match its advertised hash. */
  private async fetchRemote(
    remote: SaveSyncRemote,
    context: FileContext,
    file: RemoteFile,
  ): Promise<Buffer> {
    const content =
      context.key.kind === 'save'
        ? await remote.downloadSave(file.id, context.deviceId)
        : await remote.downloadState(file.id);
    if (file.hash !== null && md5(content) !== file.hash) {
      throw new LauncherError('download_failed', 'The downloaded save is corrupt.');
    }
    return content;
  }

  private async backUpLocal(context: FileContext, reason: BackupReason): Promise<void> {
    if (!(await readIfExists(context.path))) return;
    await this.deps.backups.backupFile(
      context.rom.platform_slug,
      context.baseName,
      context.path,
      context.key.fileName,
      reason,
    );
  }

  private record(
    context: FileContext,
    hash: string,
    remote: Pick<RemoteFile, 'id' | 'updatedAt'>,
  ): void {
    this.deps.store.putRecord(
      context.key,
      { hash, remoteId: remote.id, remoteUpdatedAt: remote.updatedAt },
      this.deps.now?.() ?? new Date(),
    );
  }

  private dirFor(rom: SyncableRom, kind: SyncKind): string {
    const { paths } = this.deps;
    return kind === 'save' ? paths.savesDir(rom.platform_slug) : paths.statesDir(rom.platform_slug);
  }

  /**
   * The server's current version of each file, keyed by the name it has on this PC.
   * RomM keeps several versions of a save per slot (with timestamped names), so the latest
   * one per file extension is the current one. States are matched by exact file name.
   */
  private async currentRemoteFiles(
    remote: SaveSyncRemote,
    rom: SyncableRom,
    baseName: string,
    kind: SyncKind,
  ): Promise<Map<string, RemoteFile>> {
    const candidates: { localName: string; file: RemoteFile }[] = [];

    if (kind === 'save') {
      for (const save of await remote.listSaves(rom.id)) {
        if (save.slot !== SAVE_SLOT) continue;
        const localName = `${baseName}.${save.file_extension.replace(/^\./, '')}`;
        candidates.push({
          localName,
          file: { id: save.id, hash: save.content_hash ?? null, updatedAt: save.updated_at },
        });
      }
    } else {
      for (const state of await remote.listStates(rom.id)) {
        candidates.push({
          localName: state.file_name,
          file: { id: state.id, hash: null, updatedAt: state.updated_at },
        });
      }
    }

    const current = new Map<string, RemoteFile>();
    for (const { localName, file } of candidates) {
      if (!belongsToGame(localName, baseName, kind)) continue;
      const existing = current.get(localName);
      // Both timestamps come from the server, so ordering them is safe.
      if (!existing || Date.parse(file.updatedAt) > Date.parse(existing.updatedAt)) {
        current.set(localName, file);
      }
    }
    return current;
  }
}

function summarize(report: SyncReport): string {
  return report.items.length === 0
    ? 'no files'
    : report.items.map((item) => `${item.fileName}: ${item.action} (${item.outcome})`).join(', ');
}
