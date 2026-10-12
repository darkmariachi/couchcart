import { spawn } from 'node:child_process';
import { readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AuthStatus,
  ImportPreview,
  PlatformCoverage,
  RomDetail,
  SetupStatus,
  ConflictResolution,
  SyncReport,
  LaunchState,
  LoginRequest,
  PlatformSummary,
  ProbeFinding,
  RomAssets,
  RomPage,
  RomQuery,
  RomSummary,
  RetroArchStatus,
  ServerInfo,
} from '../shared/ipc';
import { listInstalledCores } from './launcher/cores';
import { resolveCore, DEFAULT_CORES } from './launcher/cores';
import { LaunchService, emulatorName } from './launcher/launchService';
import { log } from './logging/logger';
import { SaveBackups } from './saves/backups';
import { SaveSyncService, type SyncableRom } from './saves/saveSyncService';
import { SyncStore } from './saves/syncStore';
import { locateRetroArch } from './launcher/retroarch';
import type { CoverSource } from './library/coverProtocol';
import { DataPaths, safeSegment } from './paths';
import {
  findImportCandidates,
  importCandidates,
  readRetroArchSaveDirs,
  toPreview,
  type ImportCandidate,
} from './saves/saveImport';
import { AuthSession } from './romm/auth';
import { createAuthenticatedFetch } from './romm/authenticatedFetch';
import { RommClient, normalizeServerUrl, probeServer, type SimpleRom } from './romm/client';
import { CredentialStore, type Encryptor } from './romm/credentials';
import { NotAuthenticatedError } from './romm/errors';
import { runApiProbe } from './romm/probe';
import { SettingsStore } from './settings/store';

interface Connection {
  auth: AuthSession;
  client: RommClient;
}

export interface LauncherAppOptions {
  dataDir: string;
  hostname: string;
  appVersion: string;
  encryptor: Encryptor;
  onLaunchStateChanged: (state: LaunchState) => void;
  /** Things only the Electron shell can do. */
  shell: {
    chooseDirectory: (startIn: string) => Promise<string | null>;
    quit: () => void;
    toggleFullscreen: () => void;
  };
}

/** File names and sizes present in one platform's cache folder. */
type CachedFiles = Map<string, number>;

/** Owns the main-process services and implements what the IPC layer exposes. */
export class LauncherApp {
  private readonly settings: SettingsStore;
  private readonly credentials: CredentialStore;
  private readonly launcher: LaunchService;
  private readonly saveSync: SaveSyncService;
  private readonly syncStore: SyncStore;
  private readonly paths: DataPaths;
  private connection: Connection | null = null;

  constructor(private readonly options: LauncherAppOptions) {
    this.settings = new SettingsStore(join(options.dataDir, 'settings.json'), options.hostname);
    this.credentials = new CredentialStore(
      join(options.dataDir, 'credentials.bin'),
      options.encryptor,
    );

    const paths = new DataPaths(options.dataDir, () => this.settings.get().cacheDir);
    this.paths = paths;
    this.syncStore = new SyncStore(join(options.dataDir, 'sync.db'));
    this.saveSync = new SaveSyncService({
      getRemote: () => this.requireConnection().client,
      store: this.syncStore,
      backups: new SaveBackups(
        join(options.dataDir, 'save-backups'),
        () => this.settings.get().saveBackupCount,
      ),
      paths,
      getDeviceId: () => this.ensureDeviceId(),
    });

    this.launcher = new LaunchService({
      getRomSource: () => this.requireConnection().client,
      getSettings: () => this.settings.get(),
      paths,
      syncSaves: (rom, emulator) => this.saveSync.syncRom(rom, emulator),
      locateRetroArch,
      listInstalledCores,
      spawn,
      onStateChanged: options.onLaunchStateChanged,
    });

    const { serverUrl, username } = this.settings.get();
    if (serverUrl) this.connection = this.connect(serverUrl);
    if (serverUrl && username) this.syncStore.bindAccount(accountKey(serverUrl, username));
  }

  probeServer(serverUrl: string): Promise<ServerInfo> {
    return probeServer(normalizeServerUrl(serverUrl));
  }

  status(): AuthStatus {
    const { serverUrl, username } = this.settings.get();
    const loggedIn = this.connection?.auth.isLoggedIn ?? false;
    return {
      serverUrl,
      username: loggedIn ? username : null,
      loggedIn,
      credentialsPersisted: this.credentials.canPersist,
    };
  }

  async login(request: LoginRequest): Promise<AuthStatus> {
    const serverUrl = normalizeServerUrl(request.serverUrl);
    const connection = this.connect(serverUrl);
    await connection.auth.login(request.username, request.password);

    // Ask the server who we are instead of trusting what was typed (it may be an email).
    const user = await connection.client.getCurrentUser();
    this.connection = connection;
    // A device id belongs to one account on one server.
    const previous = this.settings.get();
    const sameAccount = previous.serverUrl === serverUrl && previous.username === user.username;
    this.settings.update({
      serverUrl,
      username: user.username,
      deviceId: sameAccount ? previous.deviceId : null,
    });
    this.syncStore.bindAccount(accountKey(serverUrl, user.username));
    return this.status();
  }

  logout(): AuthStatus {
    this.connection?.auth.logout();
    this.settings.update({ username: null, deviceId: null });
    return this.status();
  }

  async listPlatforms(): Promise<PlatformSummary[]> {
    const platforms = await this.requireConnection().client.listPlatforms();
    return platforms
      .filter((platform) => platform.rom_count > 0)
      .map((platform) => ({
        id: platform.id,
        slug: platform.slug,
        fsSlug: platform.fs_slug,
        name: platform.display_name,
        romCount: platform.rom_count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRoms(query: RomQuery): Promise<RomPage> {
    const page = await this.requireConnection().client.listRoms(query);
    return {
      items: await this.toSummaries(page.items),
      total: page.total ?? page.items.length,
      offset: query.offset,
      limit: query.limit,
    };
  }

  /** Every game of a platform. The grid sorts, filters and searches this list locally. */
  async listPlatformRoms(platformId: number): Promise<RomSummary[]> {
    const roms: SimpleRom[] = [];
    for await (const rom of this.requireConnection().client.iterateRoms({ platformId })) {
      roms.push(rom);
    }
    return this.toSummaries(roms);
  }

  async listRecentlyPlayed(): Promise<RomSummary[]> {
    const page = await this.requireConnection().client.listRoms({ playedOnly: true, limit: 100 });
    const summaries = await this.toSummaries(page.items);
    return summaries
      .filter((rom) => rom.lastPlayed !== null)
      .sort((a, b) => Date.parse(b.lastPlayed ?? '') - Date.parse(a.lastPlayed ?? ''))
      .slice(0, 20);
  }

  async getRomDetail(romId: number): Promise<RomDetail> {
    const rom = await this.requireConnection().client.getRom(romId);
    const [summary] = await this.toSummaries([rom]);
    if (!summary) throw new Error('ROM summary missing');
    return {
      ...summary,
      platformName: rom.platform_display_name,
      description: rom.summary,
      releaseYear: toYear(rom.metadatum.first_release_date),
      genres: rom.metadatum.genres ?? [],
      coverLargePath: rom.path_cover_large,
      lastSync: this.saveSync.getLastReport(romId),
    };
  }

  /** Which platforms in the library have an installed core to run them. */
  async getCoreCoverage(): Promise<PlatformCoverage[]> {
    const [platforms, retroarch] = await Promise.all([
      this.requireConnection().client.listPlatforms(),
      this.launcher.getRetroArchStatus(),
    ]);
    const installed = new Set(retroarch.installedCores);
    return platforms
      .filter((platform) => platform.rom_count > 0)
      .map((platform) => {
        const resolution = resolveCore({
          romId: 0,
          platformSlug: platform.slug,
          platformFsSlug: platform.fs_slug,
          overrides: { platforms: this.settings.get().coreOverrides.platforms, games: {} },
          defaults: DEFAULT_CORES,
          installed,
        });
        return {
          slug: platform.slug,
          name: platform.display_name,
          romCount: platform.rom_count,
          core: resolution.found ? resolution.core : null,
          candidates: resolution.found ? [] : resolution.candidates,
        };
      });
  }

  async getRomAssets(romId: number): Promise<RomAssets> {
    const { client } = this.requireConnection();
    const [saves, states] = await Promise.all([client.listSaves(romId), client.listStates(romId)]);
    return { saves, states };
  }

  runApiProbe(): Promise<ProbeFinding[]> {
    const { client, auth } = this.requireConnection();
    return runApiProbe(client, auth);
  }

  getRetroArchStatus(): Promise<RetroArchStatus> {
    return this.launcher.getRetroArchStatus();
  }

  async play(romId: number): Promise<undefined> {
    await this.launcher.play(romId);
  }

  async downloadRom(romId: number): Promise<undefined> {
    await this.launcher.download(romId);
  }

  async deleteLocalRom(romId: number): Promise<undefined> {
    await this.launcher.deleteLocal(romId);
  }

  async getSetupStatus(): Promise<SetupStatus> {
    const settings = this.settings.get();
    return {
      complete: settings.setupComplete,
      deviceName: settings.deviceName,
      cacheDir: this.paths.romCacheDir,
      freeBytes: await freeBytesAt(this.paths.romCacheDir),
      fullscreen: settings.launcherFullscreen,
    };
  }

  async chooseCacheDir(): Promise<SetupStatus> {
    const chosen = await this.options.shell.chooseDirectory(dirname(this.paths.romCacheDir));
    if (chosen) this.settings.update({ cacheDir: chosen });
    return this.getSetupStatus();
  }

  async getImportPreview(): Promise<ImportPreview> {
    return toPreview(await this.findImportCandidates());
  }

  /** Copies matching saves from RetroArch's own folders. Returns how many were copied. */
  async importSaves(): Promise<number> {
    const imported = await importCandidates(await this.findImportCandidates());
    log.info(`Imported ${imported} existing RetroArch save file(s)`);
    return imported;
  }

  completeSetup(): Promise<SetupStatus> {
    this.settings.update({ setupComplete: true });
    return this.getSetupStatus();
  }

  quit(): undefined {
    this.options.shell.quit();
  }

  toggleFullscreen(): undefined {
    this.options.shell.toggleFullscreen();
  }

  /** Lets the cover image handler fetch with the current session. */
  get coverSource(): CoverSource {
    return this.requireConnection().client;
  }

  get launcherFullscreen(): boolean {
    return this.settings.get().launcherFullscreen;
  }

  private async findImportCandidates(): Promise<ImportCandidate[]> {
    const install = await this.launcher.locateInstall();
    if (!install) return [];
    const roms: SimpleRom[] = [];
    for await (const rom of this.requireConnection().client.iterateRoms()) roms.push(rom);
    const sourceDirs = await readRetroArchSaveDirs(install.workingDir);
    return findImportCandidates(sourceDirs, roms, this.paths);
  }

  private async toSummaries(roms: SimpleRom[]): Promise<RomSummary[]> {
    const cacheByPlatform = new Map<string, CachedFiles>();
    const summaries: RomSummary[] = [];
    for (const rom of roms) {
      let cached = cacheByPlatform.get(rom.platform_slug);
      if (!cached) {
        cached = await this.listCachedFiles(rom.platform_slug);
        cacheByPlatform.set(rom.platform_slug, cached);
      }
      summaries.push(toRomSummary(rom, cached));
    }
    return summaries;
  }

  private async listCachedFiles(platformSlug: string): Promise<CachedFiles> {
    const files: CachedFiles = new Map();
    try {
      const dir = join(this.paths.romCacheDir, safeSegment(platformSlug));
      for (const name of await readdir(dir)) {
        files.set(name, (await stat(join(dir, name))).size);
      }
    } catch {
      // Nothing downloaded for this platform yet.
    }
    return files;
  }

  getLaunchState(): LaunchState {
    return this.launcher.getState();
  }

  async syncSaves(romId: number): Promise<SyncReport> {
    const rom = await this.requireConnection().client.getRom(romId);
    return this.saveSync.syncRom(rom, await this.emulatorFor(rom));
  }

  getLastSyncReport(romId: number): SyncReport | null {
    return this.saveSync.getLastReport(romId);
  }

  async resolveConflict(resolution: ConflictResolution): Promise<SyncReport> {
    const rom = await this.requireConnection().client.getRom(resolution.romId);
    return this.saveSync.resolveConflict(rom, resolution, await this.emulatorFor(rom));
  }

  /** The core that would run this game, as the emulator label for uploads. */
  private async emulatorFor(
    rom: SyncableRom & { platform_fs_slug: string },
  ): Promise<string | null> {
    const status = await this.launcher.getRetroArchStatus();
    const resolution = resolveCore({
      romId: rom.id,
      platformSlug: rom.platform_slug,
      platformFsSlug: rom.platform_fs_slug,
      overrides: this.settings.get().coreOverrides,
      defaults: DEFAULT_CORES,
      installed: new Set(status.installedCores),
    });
    return resolution.found ? emulatorName(resolution.core) : null;
  }

  /** Registers this PC with RomM once, so saves show which device they came from. */
  private async ensureDeviceId(): Promise<string | null> {
    const { deviceId, deviceName } = this.settings.get();
    if (deviceId) return deviceId;
    try {
      const registered = await this.requireConnection().client.registerDevice({
        name: deviceName,
        hostname: this.options.hostname,
        platform: process.platform,
        clientVersion: this.options.appVersion,
      });
      this.settings.update({ deviceId: registered });
      return registered;
    } catch (error) {
      // Device tracking is a nicety; saves still sync without it.
      log.warn('Could not register this device with RomM', error);
      return null;
    }
  }

  private connect(serverUrl: string): Connection {
    const auth = new AuthSession(serverUrl, this.credentials.forServer(serverUrl));
    return { auth, client: new RommClient(serverUrl, createAuthenticatedFetch(auth)) };
  }

  private requireConnection(): Connection {
    if (!this.connection?.auth.isLoggedIn) throw new NotAuthenticatedError();
    return this.connection;
  }
}

function isCached(rom: SimpleRom, cached: CachedFiles): boolean {
  try {
    return cached.get(safeSegment(rom.fs_name)) === rom.fs_size_bytes;
  } catch {
    return false;
  }
}

/** RomM stores release dates as epoch milliseconds; older data may be in seconds. */
function toYear(releaseDate: number | null | undefined): number | null {
  if (!releaseDate) return null;
  const ms = releaseDate < 100_000_000_000 ? releaseDate * 1000 : releaseDate;
  return new Date(ms).getUTCFullYear();
}

/** Free space at a folder that may not exist yet (its nearest existing parent is used). */
async function freeBytesAt(path: string): Promise<number | null> {
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      const info = await statfs(dir);
      return info.bavail * info.bsize;
    } catch {
      if (dirname(dir) === dir) return null;
    }
  }
}

function toRomSummary(rom: SimpleRom, cached: CachedFiles): RomSummary {
  return {
    id: rom.id,
    name: rom.name ?? rom.fs_name_no_ext,
    fileName: rom.fs_name,
    sizeBytes: rom.fs_size_bytes,
    platformSlug: rom.platform_slug,
    coverPath: rom.path_cover_small,
    lastPlayed: rom.rom_user.last_played,
    hasMultipleFiles: rom.has_multiple_files,
    md5: rom.md5_hash,
    createdAt: rom.created_at,
    downloaded: isCached(rom, cached),
  };
}

function accountKey(serverUrl: string, username: string): string {
  return `${serverUrl}|${username}`;
}
