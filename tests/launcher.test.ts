import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LaunchState } from '../src/shared/ipc';
import { LauncherError } from '../src/main/errors';
import { resolveCore, type CoreRequest } from '../src/main/launcher/cores';
import { buildLaunchArgs, buildLaunchConfig } from '../src/main/launcher/launchConfig';
import {
  LaunchService,
  type LaunchServiceDeps,
  type LaunchableRom,
  type RomSource,
} from '../src/main/launcher/launchService';
import { parseSteamLibraryFolders, type RetroArchInstall } from '../src/main/launcher/retroarch';
import { DataPaths, safeSegment } from '../src/main/paths';
import { defaultSettings, type Settings } from '../src/main/settings/schema';

describe('resolveCore', () => {
  const request = (overrides: Partial<CoreRequest> = {}): CoreRequest => ({
    romId: 7,
    platformSlug: 'n64',
    platformFsSlug: 'n64',
    overrides: { platforms: {}, games: {} },
    defaults: { n64: ['mupen64plus_next_libretro', 'parallel_n64_libretro'] },
    installed: new Set(['mupen64plus_next_libretro', 'parallel_n64_libretro', 'mgba_libretro']),
    ...overrides,
  });

  it('uses the first default that is installed', () => {
    expect(resolveCore(request())).toEqual({ found: true, core: 'mupen64plus_next_libretro' });
    expect(resolveCore(request({ installed: new Set(['parallel_n64_libretro']) }))).toEqual({
      found: true,
      core: 'parallel_n64_libretro',
    });
  });

  it('prefers a platform override, and a game override over that', () => {
    const platforms = { n64: 'parallel_n64_libretro' };

    expect(resolveCore(request({ overrides: { platforms, games: {} } }))).toEqual({
      found: true,
      core: 'parallel_n64_libretro',
    });
    expect(
      resolveCore(request({ overrides: { platforms, games: { '7': 'mgba_libretro' } } })),
    ).toEqual({ found: true, core: 'mgba_libretro' });
  });

  it('does not fall back to another core when an override is not installed', () => {
    const overrides = { platforms: { n64: 'missing_libretro' }, games: {} };

    expect(resolveCore(request({ overrides }))).toEqual({
      found: false,
      candidates: ['missing_libretro'],
    });
  });

  it('falls back to the folder slug when the platform slug is unmapped', () => {
    expect(resolveCore(request({ platformSlug: 'nintendo-64-custom' }))).toMatchObject({
      found: true,
    });
  });

  it('reports what to install, or nothing for an unmapped platform', () => {
    expect(resolveCore(request({ installed: new Set() }))).toEqual({
      found: false,
      candidates: ['mupen64plus_next_libretro', 'parallel_n64_libretro'],
    });
    expect(resolveCore(request({ platformSlug: 'zx81', platformFsSlug: 'zx81' }))).toEqual({
      found: false,
      candidates: [],
    });
  });
});

describe('launch config and arguments', () => {
  it('redirects saves and states and protects the user config', () => {
    const config = buildLaunchConfig({
      savesDir: 'C:\\Data\\saves\\n64',
      statesDir: 'C:\\Data\\states\\n64',
    });

    expect(config).toContain('savefile_directory = "C:/Data/saves/n64"\n');
    expect(config).toContain('savestate_directory = "C:/Data/states/n64"\n');
    expect(config).toContain('sort_savefiles_enable = "false"');
    expect(config).toContain('sort_savestates_by_content_enable = "false"');
    expect(config).toContain('config_save_on_exit = "false"');
  });

  it('passes the ROM path as one argument, untouched', () => {
    const args = buildLaunchArgs({
      corePath: '/cores/x_libretro.so',
      romPath: '/roms/n64/Game (U) [!] "Rev A".z64',
      configPath: '/data/launcher.cfg',
      fullscreen: true,
      extraArgs: ['--verbose'],
    });

    expect(args).toEqual([
      '-L',
      '/cores/x_libretro.so',
      '/roms/n64/Game (U) [!] "Rev A".z64',
      '--appendconfig',
      '/data/launcher.cfg',
      '--fullscreen',
      '--verbose',
    ]);
  });

  it('omits --fullscreen when disabled', () => {
    const args = buildLaunchArgs({
      corePath: 'c',
      romPath: 'r',
      configPath: 'cfg',
      fullscreen: false,
      extraArgs: [],
    });

    expect(args).not.toContain('--fullscreen');
  });
});

describe('paths from server-provided names', () => {
  it('keeps ordinary ROM names intact', () => {
    expect(safeSegment('Super Mario 64 (U) [!].z64')).toBe('Super Mario 64 (U) [!].z64');
  });

  it('replaces characters Windows cannot store', () => {
    expect(safeSegment('Who? What: Why*.z64')).toBe('Who_ What_ Why_.z64');
  });

  it.each(['', '.', '..', '../evil.dll', '..\\evil.dll', 'a/b.z64', 'C:\\x.z64'])(
    'rejects %j instead of writing outside the cache',
    (name) => {
      expect(() => safeSegment(name)).toThrow(LauncherError);
    },
  );

  it('honours the cache folder override', () => {
    expect(new DataPaths('/data', () => null).romFile('n64', 'a.z64')).toBe(
      join('/data', 'roms', 'n64', 'a.z64'),
    );
    expect(new DataPaths('/data', () => '/big-disk').romFile('n64', 'a.z64')).toBe(
      join('/big-disk', 'n64', 'a.z64'),
    );
  });
});

describe('parseSteamLibraryFolders', () => {
  it('reads every library path and unescapes backslashes', () => {
    const vdf = `"libraryfolders"
{
  "0" { "path"  "C:\\\\Program Files (x86)\\\\Steam"  "label" "" }
  "1" { "path"  "D:\\\\SteamLibrary" }
}`;

    expect(parseSteamLibraryFolders(vdf)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\SteamLibrary',
    ]);
  });
});

describe('LaunchService', () => {
  let dir: string;
  let states: LaunchState[];
  let child: EventEmitter;
  let spawn: Mock<(executable: string, args: string[], options: { cwd: string }) => EventEmitter>;
  let fetchRaw: Mock<RomSource['fetchRaw']>;
  let settings: Settings;
  const syncSaves = vi.fn<LaunchServiceDeps['syncSaves']>(async (syncedRom) => ({
    romId: syncedRom.id,
    status: 'synced',
    items: [],
    at: '2026-01-01T00:00:00.000Z',
  }));
  let now: number;

  const ROM_BYTES = Buffer.from('pretend this is an N64 ROM');
  const rom: LaunchableRom = {
    id: 21,
    fs_name: 'Game (U) [!].z64',
    fs_size_bytes: ROM_BYTES.length,
    md5_hash: null,
    platform_slug: 'n64',
    platform_fs_slug: 'n64',
    platform_display_name: 'Nintendo 64',
    has_simple_single_file: true,
  };
  const install: RetroArchInstall = {
    executablePath: '/opt/retroarch/retroarch',
    workingDir: '/opt/retroarch',
    coresDir: '/opt/retroarch/cores',
    systemDir: '/opt/retroarch/system',
    kind: 'standalone',
    version: '1.22.2',
  };

  function createService(overrides: Partial<LaunchServiceDeps> = {}) {
    return new LaunchService({
      getRomSource: () => ({ getRom: async () => rom, fetchRaw }),
      getSettings: () => settings,
      paths: new DataPaths(dir, () => null),
      locateRetroArch: async () => install,
      listInstalledCores: () => new Set(['mupen64plus_next_libretro']),
      spawn: spawn as unknown as LaunchServiceDeps['spawn'],
      onStateChanged: (state) => states.push(state),
      syncSaves,
      now: () => now,
      ...overrides,
    });
  }

  /** Phases in order, with repeats (progress updates) collapsed. */
  const phases = () =>
    states.map((state) => state.phase).filter((phase, i, all) => phase !== all[i - 1]);
  const romPath = () => join(dir, 'roms', 'n64', rom.fs_name);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'romm-launcher-launch-'));
    states = [];
    syncSaves.mockClear();
    now = 1_000_000;
    settings = defaultSettings('PC');
    child = new EventEmitter();
    spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    fetchRaw = vi.fn(
      async () => new Response(ROM_BYTES, { headers: { 'content-length': `${ROM_BYTES.length}` } }),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('downloads, launches with the mapped core, and reports the exit', async () => {
    const service = createService();

    await service.play(rom.id);

    expect(readFileSync(romPath())).toEqual(ROM_BYTES);
    expect(existsSync(`${romPath()}.part`)).toBe(false);
    const [executable, args, options] = spawn.mock.calls[0] ?? ['', [], { cwd: '' }];
    expect(executable).toBe(install.executablePath);
    expect(args.slice(0, 3)).toEqual([
      '-L',
      join(
        install.coresDir,
        `mupen64plus_next_libretro${process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'}`,
      ),
      romPath(),
    ]);
    expect(options.cwd).toBe(install.workingDir);
    expect(readFileSync(args[4] ?? '', 'utf8')).toContain('savefile_directory');
    expect(existsSync(join(dir, 'saves', 'n64'))).toBe(true);
    expect(service.getState().phase).toBe('running');

    now += 90_000;
    child.emit('exit', 0);
    await vi.waitFor(() => expect(service.getState().phase).toBe('exited'));

    expect(service.getState()).toMatchObject({
      phase: 'exited',
      romId: rom.id,
      exitCode: 0,
      playedSeconds: 90,
      sync: { status: 'synced' },
    });
    expect(phases()).toEqual([
      'starting',
      'downloading',
      'starting',
      'syncing',
      'starting',
      'running',
      'syncing',
      'exited',
    ]);
    // Saves are synced once before the game starts and once after it exits.
    expect(syncSaves).toHaveBeenCalledTimes(2);
    expect(syncSaves).toHaveBeenLastCalledWith(rom, 'mupen64plus_next');
  });

  it('does not download a ROM that is already in the cache', async () => {
    mkdirSync(dirname(romPath()), { recursive: true });
    writeFileSync(romPath(), ROM_BYTES);

    await createService().play(rom.id);

    expect(fetchRaw).not.toHaveBeenCalled();
    expect(phases()).toEqual(['starting', 'syncing', 'starting', 'running']);
  });

  it('refuses a second game while one is running, then allows one after exit', async () => {
    const service = createService();
    await service.play(rom.id);

    await expect(service.play(rom.id)).rejects.toMatchObject({ code: 'busy' });
    expect(service.getState().phase).toBe('running');

    child.emit('exit', 0);
    await vi.waitFor(() => expect(service.getState().phase).toBe('exited'));
    await expect(service.play(rom.id)).resolves.toBeUndefined();
  });

  it('explains a missing core before downloading anything', async () => {
    const service = createService({ listInstalledCores: () => new Set() });

    await expect(service.play(rom.id)).rejects.toMatchObject({
      code: 'core_missing',
      message: expect.stringContaining('mupen64plus_next'),
    });
    expect(fetchRaw).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ phase: 'failed', error: { code: 'core_missing' } });
  });

  it('points Steam users to DLC and others to the Online Updater', async () => {
    const noCores = { listInstalledCores: () => new Set<string>() };
    const steam = createService({
      ...noCores,
      locateRetroArch: async () => ({ ...install, kind: 'steam' }),
    });

    await expect(steam.play(rom.id)).rejects.toThrow(/DLC/);
    await expect(createService(noCores).play(rom.id)).rejects.toThrow(/Online Updater/);
  });

  it('reports when RetroArch is not installed', async () => {
    const service = createService({ locateRetroArch: async () => null });

    await expect(service.play(rom.id)).rejects.toMatchObject({ code: 'retroarch_not_found' });
    expect(fetchRaw).not.toHaveBeenCalled();
  });

  it('rejects multi-file games for now', async () => {
    const service = createService({
      getRomSource: () => ({
        getRom: async () => ({ ...rom, has_simple_single_file: false }),
        fetchRaw,
      }),
    });

    await expect(service.play(rom.id)).rejects.toMatchObject({ code: 'unsupported_rom' });
  });

  it('fails cleanly when the executable cannot be started', async () => {
    spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    });
    const service = createService();

    await expect(service.play(rom.id)).rejects.toMatchObject({ code: 'launch_failed' });
    expect(service.getState().phase).toBe('failed');
    await expect(service.play(rom.id)).rejects.toMatchObject({ code: 'launch_failed' }); // not stuck busy
  });

  it('honours the fullscreen setting and extra arguments', async () => {
    settings = {
      ...settings,
      retroarch: { ...settings.retroarch, fullscreen: false, extraArgs: ['--verbose'] },
    };

    await createService().play(rom.id);

    const args = spawn.mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain('--fullscreen');
    expect(args.at(-1)).toBe('--verbose');
  });
});
