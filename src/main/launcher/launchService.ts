import type { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaunchState, RetroArchStatus, SyncReport } from '../../shared/ipc';
import { downloadRom, isDownloaded, type RomContentSource } from '../downloads/romDownloader';
import { LauncherError } from '../errors';
import { writeFileAtomicSync } from '../fs/atomic';
import { toIpcError } from '../ipc/errors';
import { log } from '../logging/logger';
import type { DataPaths } from '../paths';
import type { Settings } from '../settings/schema';
import { DEFAULT_CORES, coreFileExtension, resolveCore, type CoreMap } from './cores';
import { buildLaunchArgs, buildLaunchConfig } from './launchConfig';
import type { LocateOptions, RetroArchInstall } from './retroarch';

/** The parts of a RomM ROM record the launcher needs. */
export interface LaunchableRom {
  id: number;
  fs_name: string;
  fs_size_bytes: number;
  md5_hash: string | null;
  platform_slug: string;
  platform_fs_slug: string;
  platform_display_name: string;
  has_simple_single_file: boolean;
}

export interface RomSource extends RomContentSource {
  getRom(id: number): Promise<LaunchableRom>;
  markPlayed(id: number): Promise<void>;
}

export interface LaunchServiceDeps {
  /** Throws when not logged in. */
  getRomSource: () => RomSource;
  getSettings: () => Settings;
  paths: DataPaths;
  locateRetroArch: (options: LocateOptions) => Promise<RetroArchInstall | null>;
  listInstalledCores: (coresDir: string) => Set<string>;
  spawn: typeof nodeSpawn;
  onStateChanged: (state: LaunchState) => void;
  /** Brings saves in line with the server. Must not throw; problems go in the report. */
  syncSaves: (rom: LaunchableRom, emulator: string) => Promise<SyncReport>;
  defaultCores?: CoreMap;
  now?: () => number;
}

/** Takes a game from "selected" to "running in RetroArch" and reports when it exits. */
export class LaunchService {
  private state: LaunchState = { phase: 'idle' };

  constructor(private readonly deps: LaunchServiceDeps) {}

  getState(): LaunchState {
    return this.state;
  }

  async getRetroArchStatus(): Promise<RetroArchStatus> {
    const install = await this.locateInstall();
    if (!install) {
      return {
        found: false,
        executablePath: null,
        kind: null,
        version: null,
        coresDir: null,
        installedCores: [],
      };
    }
    return {
      found: true,
      executablePath: install.executablePath,
      kind: install.kind,
      version: install.version,
      coresDir: install.coresDir,
      installedCores: [...this.deps.listInstalledCores(install.coresDir)].sort(),
    };
  }

  /** Resolves once RetroArch is running. Its exit is reported through onStateChanged. */
  async play(romId: number): Promise<void> {
    if (this.isBusy)
      throw new LauncherError('busy', 'Another game is already starting or running.');

    this.setState({ phase: 'starting', romId });
    try {
      const source = this.deps.getRomSource();
      const rom = await source.getRom(romId);
      this.requireSingleFile(rom);

      // Check everything RetroArch needs before spending time on a download.
      const install = await this.requireRetroArch();
      const core = this.requireCore(rom, install);

      const romPath = await this.ensureDownloaded(source, rom);

      // Pull newer saves from other PCs before the game reads them.
      this.setState({ phase: 'syncing', romId, stage: 'before-launch' });
      await this.deps.syncSaves(rom, emulatorName(core));
      this.setState({ phase: 'starting', romId });

      await this.startRetroArch(rom, install, core, romPath);
    } catch (error) {
      log.warn(`Launching ROM ${romId} failed`, error);
      this.setState({ phase: 'failed', romId, error: toIpcError(error) });
      throw error;
    }
  }

  /** Puts a game in the cache without starting it. */
  async download(romId: number): Promise<void> {
    if (this.isBusy)
      throw new LauncherError('busy', 'Another game is already starting or running.');

    this.setState({ phase: 'starting', romId });
    try {
      const source = this.deps.getRomSource();
      const rom = await source.getRom(romId);
      this.requireSingleFile(rom);
      await this.ensureDownloaded(source, rom);
      this.setState({ phase: 'idle' });
    } catch (error) {
      log.warn(`Downloading ROM ${romId} failed`, error);
      this.setState({ phase: 'failed', romId, error: toIpcError(error) });
      throw error;
    }
  }

  /** Removes a game from the cache. Saves and states are kept. */
  async deleteLocal(romId: number): Promise<void> {
    if (this.isBusy) throw new LauncherError('busy', 'A game is starting or running.');
    const rom = await this.deps.getRomSource().getRom(romId);
    const romPath = this.deps.paths.romFile(rom.platform_slug, rom.fs_name);
    await Promise.all([rm(romPath, { force: true }), rm(`${romPath}.part`, { force: true })]);
  }

  private requireSingleFile(rom: LaunchableRom): void {
    if (!rom.has_simple_single_file) {
      throw new LauncherError(
        'unsupported_rom',
        'Multi-file and multi-disc games are not supported yet.',
      );
    }
  }

  /** Returns the path of the ROM in the cache, downloading it first when needed. */
  private async ensureDownloaded(source: RomSource, rom: LaunchableRom): Promise<string> {
    const romPath = this.deps.paths.romFile(rom.platform_slug, rom.fs_name);
    const download = {
      romId: rom.id,
      fileName: rom.fs_name,
      sizeBytes: rom.fs_size_bytes,
      md5: rom.md5_hash,
      destination: romPath,
    };
    if (await isDownloaded(download)) return romPath;

    const progress = { phase: 'downloading', romId: rom.id } as const;
    this.setState({ ...progress, receivedBytes: 0, totalBytes: rom.fs_size_bytes });
    await downloadRom(source, download, {
      onProgress: (update) => this.setState({ ...progress, ...update }),
    });
    this.setState({ phase: 'starting', romId: rom.id });
    return romPath;
  }

  private get isBusy(): boolean {
    return ['downloading', 'starting', 'syncing', 'running'].includes(this.state.phase);
  }

  locateInstall(): Promise<RetroArchInstall | null> {
    const { executablePath, coresDir } = this.deps.getSettings().retroarch;
    return this.deps.locateRetroArch({ executablePath, coresDir });
  }

  private async requireRetroArch(): Promise<RetroArchInstall> {
    const install = await this.locateInstall();
    if (install) return install;
    throw new LauncherError(
      'retroarch_not_found',
      'RetroArch was not found. Install it, or set its location in settings.',
    );
  }

  private requireCore(rom: LaunchableRom, install: RetroArchInstall): string {
    const resolution = resolveCore({
      romId: rom.id,
      platformSlug: rom.platform_slug,
      platformFsSlug: rom.platform_fs_slug,
      overrides: this.deps.getSettings().coreOverrides,
      defaults: this.deps.defaultCores ?? DEFAULT_CORES,
      installed: this.deps.listInstalledCores(install.coresDir),
    });
    if (resolution.found) return resolution.core;

    const platform = rom.platform_display_name;
    if (resolution.candidates.length === 0) {
      throw new LauncherError(
        'core_missing',
        `No RetroArch core is mapped to ${platform} yet. Choose one in settings.`,
      );
    }
    const wanted = resolution.candidates.map((name) => name.replace(/_libretro$/, '')).join(', ');
    const howTo =
      install.kind === 'steam'
        ? "In Steam, open RetroArch's page and add the core under DLC."
        : 'In RetroArch, open Online Updater → Core Downloader.';
    throw new LauncherError(
      'core_missing',
      `No core for ${platform} is installed. Any of these works: ${wanted}. ${howTo}`,
    );
  }

  private async startRetroArch(
    rom: LaunchableRom,
    install: RetroArchInstall,
    core: string,
    romPath: string,
  ): Promise<void> {
    const { paths, spawn } = this.deps;
    const now = this.deps.now ?? Date.now;
    const settings = this.deps.getSettings().retroarch;

    const savesDir = paths.savesDir(rom.platform_slug);
    const statesDir = paths.statesDir(rom.platform_slug);
    await Promise.all([
      mkdir(savesDir, { recursive: true }),
      mkdir(statesDir, { recursive: true }),
    ]);
    writeFileAtomicSync(paths.launchConfigFile, buildLaunchConfig({ savesDir, statesDir }));

    const args = buildLaunchArgs({
      corePath: join(install.coresDir, `${core}${coreFileExtension()}`),
      romPath,
      configPath: paths.launchConfigFile,
      fullscreen: settings.fullscreen,
      extraArgs: settings.extraArgs,
    });

    // No shell, so file names with spaces, quotes or brackets need no escaping. The working
    // directory matters: the Steam build only finds its Steam helper from its own folder.
    const child = spawn(install.executablePath, args, {
      cwd: install.workingDir,
      stdio: 'ignore',
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (cause) =>
        reject(new LauncherError('launch_failed', 'RetroArch could not be started.', { cause })),
      );
    });

    const startedAt = now();
    log.info(`RetroArch started for ROM ${rom.id} with ${core}`);
    this.setState({
      phase: 'running',
      romId: rom.id,
      core,
      startedAt: new Date(startedAt).toISOString(),
    });

    // Best effort: "recently played" in RomM is a convenience, not a reason to fail.
    void this.deps
      .getRomSource()
      .markPlayed(rom.id)
      .catch((error: unknown) => log.warn('Could not update last played', error));

    child.once('exit', (exitCode) => {
      const playedSeconds = Math.round((now() - startedAt) / 1000);
      log.info(`RetroArch exited (code ${exitCode}) after ${playedSeconds}s`);
      // RetroArch has closed its files, so whatever it wrote can go to the server now.
      this.setState({ phase: 'syncing', romId: rom.id, stage: 'after-exit' });
      void this.deps.syncSaves(rom, emulatorName(core)).then((sync) => {
        this.setState({ phase: 'exited', romId: rom.id, exitCode, playedSeconds, sync });
      });
    });
  }

  private setState(state: LaunchState): void {
    this.state = state;
    this.deps.onStateChanged(state);
  }
}

/** RomM labels saves with the core name without the libretro suffix. */
export function emulatorName(core: string): string {
  return core.replace(/_libretro$/, '');
}
