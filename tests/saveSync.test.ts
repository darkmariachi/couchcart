import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncItemResult } from '../src/shared/ipc';
import { DataPaths } from '../src/main/paths';
import type { FileUpload, Save, SaveUpload, State } from '../src/main/romm/client';
import { NetworkError, RommApiError } from '../src/main/romm/errors';
import { SaveBackups } from '../src/main/saves/backups';
import { md5 } from '../src/main/saves/localFiles';
import {
  SAVE_SLOT,
  SaveSyncService,
  type SaveSyncRemote,
  type SyncableRom,
} from '../src/main/saves/saveSyncService';
import { SyncStore } from '../src/main/saves/syncStore';

const rom: SyncableRom = { id: 21, fs_name: 'Game (U) [!].z64', platform_slug: 'n64' };
const SAVE = 'Game (U) [!].srm';
const STATE = 'Game (U) [!].state1';
const DEVICE = 'device-this-pc';

/** An in-memory RomM that behaves like the real one where the sync engine can tell. */
class FakeRemote implements SaveSyncRemote {
  saves: (Save & { content: Buffer })[] = [];
  states: (State & { content: Buffer })[] = [];
  uploads: SaveUpload[] = [];
  confirmed: { id: number; deviceId: string; hash: string }[] = [];
  offline = false;
  rejectUploadsWith409 = false;
  corruptDownloads = false;
  private nextId = 100;
  private clock = Date.UTC(2026, 0, 1);

  private tick(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }

  private check(): void {
    if (this.offline) throw new NetworkError('Could not reach the RomM server.');
  }

  /** Simulates another device (or the web UI) adding a new version of a save. */
  addSave(content: string, overrides: Partial<Save> = {}): Save {
    const updatedAt = this.tick();
    const save = {
      id: this.nextId++,
      rom_id: rom.id,
      // RomM stores each version under a timestamped name.
      file_name: `Game (U) [!] [${updatedAt.replace(/[:.]/g, '-')}].srm`,
      file_extension: 'srm',
      slot: SAVE_SLOT,
      content_hash: md5(Buffer.from(content)),
      updated_at: updatedAt,
      ...overrides,
      content: Buffer.from(content),
    } as Save & { content: Buffer };
    this.saves.push(save);
    return save;
  }

  addState(fileName: string, content: string): State {
    const state = {
      id: this.nextId++,
      rom_id: rom.id,
      file_name: fileName,
      updated_at: this.tick(),
      content: Buffer.from(content),
    } as State & { content: Buffer };
    this.states.push(state);
    return state;
  }

  get currentSave(): (Save & { content: Buffer }) | undefined {
    return this.saves.at(-1);
  }

  async listSaves(romId: number) {
    this.check();
    return this.saves.filter((save) => save.rom_id === romId);
  }

  async listStates(romId: number) {
    this.check();
    return this.states.filter((state) => state.rom_id === romId);
  }

  async uploadSave(upload: SaveUpload) {
    this.check();
    if (this.rejectUploadsWith409 && !upload.overwrite) {
      throw new RommApiError(409, 'Save has been updated since your last sync');
    }
    this.uploads.push(upload);
    return this.addSave(upload.content.toString(), { slot: upload.slot });
  }

  async downloadSave(id: number) {
    this.check();
    const save = this.saves.find((candidate) => candidate.id === id);
    if (!save) throw new RommApiError(404, 'Save not found');
    return this.corruptDownloads ? Buffer.from('garbage') : save.content;
  }

  async confirmSaveDownloaded(id: number, deviceId: string, hash: string) {
    this.confirmed.push({ id, deviceId, hash });
  }

  async uploadState(upload: FileUpload) {
    this.check();
    return this.addState(upload.fileName, upload.content.toString());
  }

  async replaceState(id: number, upload: FileUpload) {
    this.check();
    const state = this.states.find((candidate) => candidate.id === id);
    if (!state) throw new RommApiError(404, 'State not found');
    state.content = upload.content;
    state.updated_at = this.tick();
    return state;
  }

  async listDevices() {
    return [{ id: 'device-other-pc', name: 'LIVINGROOM-PC' }];
  }

  async downloadState(id: number) {
    this.check();
    const state = this.states.find((candidate) => candidate.id === id);
    if (!state) throw new RommApiError(404, 'State not found');
    return state.content;
  }
}

let dir: string;
let remote: FakeRemote;
let store: SyncStore;
let backups: SaveBackups;
let service: SaveSyncService;
let keepBackups: number;
let backupClock: number;

const savesDir = () => join(dir, 'saves', 'n64');
const statesDir = () => join(dir, 'states', 'n64');
const savePath = () => join(savesDir(), SAVE);
const statePath = () => join(statesDir(), STATE);
const localSave = () => (existsSync(savePath()) ? readFileSync(savePath(), 'utf8') : null);
const writeLocalSave = (content: string) => writeFileSync(savePath(), content);
const backupList = () => backups.list('n64', 'Game (U) [!]');
const readBackup = (name: string) =>
  readFileSync(join(dir, 'save-backups', 'n64', 'Game (U) [!]', name), 'utf8');

const sync = () => service.syncRom(rom, 'mupen64plus_next');
const itemFor = (items: SyncItemResult[], fileName: string) =>
  items.find((item) => item.fileName === fileName);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'romm-launcher-sync-'));
  mkdirSync(savesDir(), { recursive: true });
  mkdirSync(statesDir(), { recursive: true });
  remote = new FakeRemote();
  store = new SyncStore(':memory:');
  keepBackups = 10;
  backupClock = Date.UTC(2026, 5, 1);
  backups = new SaveBackups(
    join(dir, 'save-backups'),
    () => keepBackups,
    () => new Date((backupClock += 1000)),
  );
  service = new SaveSyncService({
    getRemote: () => remote,
    store,
    backups,
    paths: new DataPaths(dir, () => null),
    getDeviceId: async () => DEVICE,
  });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('first sync of a game', () => {
  it('uploads a save that only exists on this PC', async () => {
    writeLocalSave('progress-1');

    const report = await sync();

    expect(report.status).toBe('synced');
    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'upload', outcome: 'done' });
    expect(remote.currentSave?.content.toString()).toBe('progress-1');
    expect(remote.uploads[0]).toMatchObject({
      romId: rom.id,
      fileName: SAVE,
      slot: SAVE_SLOT,
      emulator: 'mupen64plus_next',
      deviceId: DEVICE,
      contentHash: md5(Buffer.from('progress-1')),
      overwrite: false,
    });
  });

  it('downloads a save that only exists on the server, under the name RetroArch expects', async () => {
    const serverSave = remote.addSave('from-another-pc');

    const report = await sync();

    expect(report.status).toBe('synced');
    expect(localSave()).toBe('from-another-pc');
    expect(remote.confirmed).toEqual([
      { id: serverSave.id, deviceId: DEVICE, hash: serverSave.content_hash },
    ]);
    expect(await backupList()).toEqual([]);
  });

  it('links identical copies without transferring or backing up anything', async () => {
    writeLocalSave('same');
    remote.addSave('same');

    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'link', outcome: 'done' });
    expect(remote.uploads).toHaveLength(0);
    expect((await sync()).items[0]).toMatchObject({ action: 'none' });
  });

  it('reports nothing to do for a game without saves', async () => {
    expect(await sync()).toMatchObject({ status: 'synced', items: [] });
  });
});

describe('continuing between PCs', () => {
  beforeEach(async () => {
    writeLocalSave('v1');
    await sync();
  });

  it('does nothing when nothing changed', async () => {
    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'none', outcome: 'done' });
    expect(remote.saves).toHaveLength(1);
  });

  it('uploads progress made on this PC as a new server version', async () => {
    writeLocalSave('v2-local');

    await sync();

    expect(remote.saves).toHaveLength(2);
    expect(remote.currentSave?.content.toString()).toBe('v2-local');
  });

  it('downloads progress made elsewhere and backs up what it replaces', async () => {
    remote.addSave('v2-other-pc');

    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'download', outcome: 'done' });
    expect(localSave()).toBe('v2-other-pc');
    const [backup] = await backupList();
    expect(backup).toMatch(/__replaced-by-server__Game \(U\) \[!\]\.srm$/);
    expect(readBackup(backup ?? '')).toBe('v1');
  });

  it('uses the newest server version when several exist', async () => {
    remote.addSave('v2');
    remote.addSave('v3');

    await sync();

    expect(localSave()).toBe('v3');
  });

  it('restores a save that went missing on this PC', async () => {
    rmSync(savePath());

    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'download' });
    expect(localSave()).toBe('v1');
  });
});

describe('conflicts', () => {
  beforeEach(async () => {
    writeLocalSave('v1');
    await sync();
    writeLocalSave('v2-this-pc');
    remote.addSave('v2-other-pc');
  });

  it('change nothing on either side', async () => {
    const report = await sync();

    expect(report.status).toBe('conflict');
    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'conflict', outcome: 'conflict' });
    expect(localSave()).toBe('v2-this-pc');
    expect(remote.currentSave?.content.toString()).toBe('v2-other-pc');
    expect(remote.uploads).toHaveLength(1); // only the original v1
  });

  it('describe both sides so the user can choose', async () => {
    remote.addSave('v3-other-pc', { origin_device_id: 'device-other-pc' });

    const item = itemFor((await sync()).items, SAVE);

    expect(item?.conflict).toEqual({
      localModifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      serverUpdatedAt: remote.currentSave?.updated_at,
      serverDevice: 'LIVINGROOM-PC',
    });
  });

  it('stay a conflict on every later sync until resolved', async () => {
    await sync();
    writeLocalSave('v3-this-pc'); // the player keeps going on this PC

    expect((await sync()).status).toBe('conflict');
    expect(remote.currentSave?.content.toString()).toBe('v2-other-pc');
  });

  it("can be resolved for this PC's save, keeping the server's as a backup", async () => {
    const report = await service.resolveConflict(
      rom,
      { romId: rom.id, kind: 'save', fileName: SAVE, keep: 'local' },
      'mupen64plus_next',
    );

    expect(report.status).toBe('synced');
    expect(remote.currentSave?.content.toString()).toBe('v2-this-pc');
    expect(remote.uploads.at(-1)?.overwrite).toBe(true);
    expect(localSave()).toBe('v2-this-pc');
    const [backup] = await backupList();
    expect(backup).toMatch(/__server-copy__/);
    expect(readBackup(backup ?? '')).toBe('v2-other-pc');
  });

  it("can be resolved for the server's save, keeping this PC's as a backup", async () => {
    const report = await service.resolveConflict(
      rom,
      { romId: rom.id, kind: 'save', fileName: SAVE, keep: 'server' },
      'mupen64plus_next',
    );

    expect(report.status).toBe('synced');
    expect(localSave()).toBe('v2-other-pc');
    const [backup] = await backupList();
    expect(backup).toMatch(/__conflict-local__/);
    expect(readBackup(backup ?? '')).toBe('v2-this-pc');
  });

  it('refuses to resolve a file that is not one of the game', async () => {
    await expect(
      service.resolveConflict(
        rom,
        { romId: rom.id, kind: 'save', fileName: 'Other Game.srm', keep: 'server' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('a server that changes during the sync', () => {
  it('turns a rejected upload into a conflict instead of overwriting', async () => {
    writeLocalSave('v1');
    remote.rejectUploadsWith409 = true;

    const report = await sync();

    expect(report.status).toBe('conflict');
    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'upload', outcome: 'conflict' });
    expect(remote.saves).toHaveLength(0);
    expect(localSave()).toBe('v1');
  });
});

describe('deletions on the server', () => {
  beforeEach(async () => {
    writeLocalSave('v1');
    await sync();
    remote.saves = [];
  });

  it('remove the unchanged local copy, but only after backing it up', async () => {
    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'delete_local', outcome: 'done' });
    expect(localSave()).toBeNull();
    const [backup] = await backupList();
    expect(backup).toMatch(/__deleted-on-server__/);
    expect(readBackup(backup ?? '')).toBe('v1');
    expect((await sync()).items).toEqual([]);
  });

  it('do not discard progress made here since the last sync', async () => {
    writeLocalSave('v2-new-progress');

    const report = await sync();

    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'upload' });
    expect(localSave()).toBe('v2-new-progress');
    expect(remote.currentSave?.content.toString()).toBe('v2-new-progress');
  });
});

describe('offline and failures', () => {
  it('changes nothing while the server is unreachable, then catches up', async () => {
    writeLocalSave('played-offline');
    remote.offline = true;

    const offline = await sync();

    expect(offline).toMatchObject({ status: 'offline', items: [] });
    expect(localSave()).toBe('played-offline');
    expect(service.getLastReport(rom.id)?.status).toBe('offline');

    remote.offline = false;
    expect((await sync()).status).toBe('synced');
    expect(remote.currentSave?.content.toString()).toBe('played-offline');
  });

  it('keeps the local save when the downloaded one is corrupt', async () => {
    writeLocalSave('v1');
    await sync();
    remote.addSave('v2-other-pc');
    remote.corruptDownloads = true;

    const report = await sync();

    expect(report.status).toBe('error');
    expect(itemFor(report.items, SAVE)).toMatchObject({ action: 'download', outcome: 'failed' });
    expect(localSave()).toBe('v1');
    expect(await backupList()).toEqual([]);

    remote.corruptDownloads = false;
    expect((await sync()).status).toBe('synced');
    expect(localSave()).toBe('v2-other-pc');
  });

  it('still syncs the other files when one fails', async () => {
    writeLocalSave('v1');
    writeFileSync(statePath(), 'state-1');
    remote.rejectUploadsWith409 = true; // only affects saves

    const report = await sync();

    expect(itemFor(report.items, SAVE)?.outcome).toBe('conflict');
    expect(itemFor(report.items, STATE)).toMatchObject({ action: 'upload', outcome: 'done' });
  });
});

describe('save states', () => {
  it('uploads a new state and then leaves it alone', async () => {
    writeFileSync(statePath(), 'state-1');

    await sync();
    const second = await sync();

    expect(remote.states).toHaveLength(1);
    expect(remote.states[0]).toMatchObject({ file_name: STATE });
    expect(itemFor(second.items, STATE)).toMatchObject({ action: 'none' });
  });

  it('replaces the server state in place when it changes here', async () => {
    writeFileSync(statePath(), 'state-1');
    await sync();
    writeFileSync(statePath(), 'state-2');

    await sync();

    expect(remote.states).toHaveLength(1);
    expect(remote.states[0]?.content.toString()).toBe('state-2');
  });

  it('downloads a state that changed on the server, with a backup', async () => {
    writeFileSync(statePath(), 'state-1');
    await sync();
    const serverState = remote.states[0];
    if (!serverState) throw new Error('state was not uploaded');
    await remote.replaceState(serverState.id, {
      fileName: STATE,
      content: Buffer.from('state-other-pc'),
    });

    const report = await sync();

    expect(itemFor(report.items, STATE)).toMatchObject({ action: 'download', outcome: 'done' });
    expect(readFileSync(statePath(), 'utf8')).toBe('state-other-pc');
    expect((await backupList())[0]).toMatch(/__replaced-by-server__Game \(U\) \[!\]\.state1$/);
  });

  it('downloads states made on another PC, including the auto state', async () => {
    remote.addState('Game (U) [!].state.auto', 'auto');
    remote.addState(STATE, 'slot-1');

    await sync();

    expect(readFileSync(join(statesDir(), 'Game (U) [!].state.auto'), 'utf8')).toBe('auto');
    expect(readFileSync(statePath(), 'utf8')).toBe('slot-1');
  });
});

describe('what counts as this game', () => {
  it('ignores other games, thumbnails and leftovers in the same folders', async () => {
    writeFileSync(join(savesDir(), 'Game (U) [!] 2.srm'), 'other game');
    writeFileSync(join(savesDir(), 'Game (U).srm'), 'other dump');
    writeFileSync(join(savesDir(), `${SAVE}.tmp`), 'leftover');
    writeFileSync(join(statesDir(), `${STATE}.png`), 'thumbnail');

    expect((await sync()).items).toEqual([]);
    expect(remote.saves).toHaveLength(0);
    expect(remote.states).toHaveLength(0);
  });

  it('ignores server saves in other slots and files that could escape the folder', async () => {
    remote.addSave('manual upload', { slot: null });
    remote.addSave('quick slot', { slot: 'slot1' });
    remote.addState('../../evil.state', 'x');
    remote.addState('Another Game.state1', 'x');

    expect((await sync()).items).toEqual([]);
    expect(localSave()).toBeNull();
  });

  it('syncs each save extension of a game separately', async () => {
    writeLocalSave('battery');
    writeFileSync(join(savesDir(), 'Game (U) [!].rtc'), 'clock');

    const report = await sync();

    expect(report.items.map((item) => item.fileName)).toEqual(['Game (U) [!].rtc', SAVE]);
    expect(remote.uploads.map((upload) => upload.fileName).sort()).toEqual([
      'Game (U) [!].rtc',
      SAVE,
    ]);
  });
});

describe('backups', () => {
  it('keeps only the configured number per game, dropping the oldest', async () => {
    keepBackups = 3;
    writeLocalSave('v0');
    await sync();
    for (let version = 1; version <= 5; version++) {
      remote.addSave(`server-v${version}`);
      await sync(); // each download backs up the previous local file
    }

    const kept = await backupList();

    expect(kept).toHaveLength(3);
    expect(kept.map(readBackup)).toEqual(['server-v2', 'server-v3', 'server-v4']);
  });
});
