import type { spawn as nodeSpawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  LaunchBlock,
  LaunchState,
  PlayRequest,
  RetroArchStatus,
  SyncReport,
} from '../../shared/ipc';
import { enforceCachePolicy } from '../downloads/cacheJanitor';
import type { DownloadManager } from '../downloads/downloadManager';
import {
  isPlanDownloaded,
  planRomFiles,
  removeFromCache,
  resolveLaunchTarget,
  touchPlan,
  type RomFilePlan,
  type RomFilesSource,
} from '../downloads/romFiles';
import { LauncherError } from '../errors';
import { writeFileAtomicSync } from '../fs/atomic';
import { toIpcError } from '../ipc/errors';
import { log } from '../logging/logger';
import type { DataPaths } from '../paths';
import type { Settings } from '../settings/schema';
import { findMissingBios } from './bios';
import { DEFAULT_CORES, coreFileExtension, resolveCore, type CoreMap } from './cores';
import { buildbotPlatform, canSetUpRetroArch } from './emulatorSetup';
import { buildLaunchArgs, buildLaunchConfig } from './launchConfig';
import type { LocateOptions, RetroArchInstall } from './retroarch';

/** The parts of a RomM ROM record the launcher needs. */
export interface LaunchableRom extends RomFilesSource {
  name: string | null;
  platform_fs_slug: string;
  platform_display_name: string;
}

export interface RomSource {
  /** May answer from the local copy of the library when the server is unreachable. */
  getRom(id: number): Promise<LaunchableRom>;
  markPlayed(id: number): Promise<void>;
}

export interface LaunchServiceDeps {
  /** Throws when not logged in. */
  getRomSource: () => RomSource;
  getSettings: () => Settings;
  paths: DataPaths;
  downloads: DownloadManager;
  locateRetroArch: (options: LocateOptions) => Promise<RetroArchInstall | null>;
  listInstalledCores: (coresDir: string) => Set<string>;
  spawn: typeof nodeSpawn;
  onStateChanged: (state: LaunchState) => void;
  /** Brings saves in line with the server. Must not throw; problems go in the report. */
  syncSaves: (rom: LaunchableRom, emulator: string) => Promise<SyncReport>;
  /** Extra RetroArch settings that put the connected controllers on player ports. */
  getControllerSettings: () => Promise<Record<string, string>>;
  /** Downloads the first available of `candidates` into the install; resolves with its name. */
  installCore?: (candidates: string[], install: RetroArchInstall) => Promise<string>;
  findMissingBios?: typeof findMissingBios;
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

  /** True while a game is being prepared or is running. */
  get isBusy(): boolean {
    return ['downloading', 'starting', 'installing-core', 'syncing', 'running'].includes(
      this.state.phase,
    );
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
        managed: false,
        canSetUp: canSetUpRetroArch(),
        canInstallCores: false,
      };
    }
    return {
      found: true,
      executablePath: install.executablePath,
      kind: install.kind,
      version: install.version,
      coresDir: install.coresDir,
      installedCores: [...this.deps.listInstalledCores(install.coresDir)].sort(),
      managed: install.managed,
      canSetUp: canSetUpRetroArch(),
      canInstallCores: canDownloadCores(install),
    };
  }

  locateInstall(): Promise<RetroArchInstall | null> {
    const { executablePath, coresDir } = this.deps.getSettings().retroarch;
    return this.deps.locateRetroArch({ executablePath, coresDir });
  }

  /**
   * Resolves once RetroArch is running, or once the launch stops at a decision the user
   * has to make (state `blocked`). The game's exit is reported through onStateChanged.
   */
  async play(request: PlayRequest): Promise<void> {
    if (this.isBusy)
      throw new LauncherError('busy', 'Another game is already starting or running.');

    const { romId } = request;
    this.setState({ phase: 'starting', romId });
    try {
      const rom = await this.deps.getRomSource().getRom(romId);

      // Check everything RetroArch needs before spending time on a download.
      const install = await this.requireRetroArch();
      const core = await this.prepareCore(rom, install, request);
      if (!core) return; // waiting for the user to agree to a download

      if (!request.ignoreMissingBios) {
        const check = this.deps.findMissingBios ?? findMissingBios;
        const missing = await check([rom.platform_slug, rom.platform_fs_slug], install.systemDir);
        if (missing.length > 0) {
          this.block(romId, {
            type: 'bios',
            platformName: rom.platform_display_name,
            missing,
            systemDir: install.systemDir,
          });
          return;
        }
      }

      const plan = planRomFiles(rom, this.deps.paths);
      await this.ensureDownloaded(rom, plan);

      // Pull newer saves from other PCs before the game reads them.
      this.setState({ phase: 'syncing', romId, stage: 'before-launch' });
      const sync = await this.deps.syncSaves(rom, emulatorName(core));
      const conflicts = sync.items.filter((item) => item.outcome === 'conflict');
      if (conflicts.length > 0 && !request.ignoreConflicts) {
        this.block(romId, { type: 'conflict', conflicts });
        return;
      }

      this.setState({ phase: 'starting', romId });
      await this.startRetroArch(rom, install, core, plan);
    } catch (error) {
      log.warn(`Launching ROM ${romId} failed`, error);
      this.setState({ phase: 'failed', romId, error: toIpcError(error) });
      throw error;
    }
  }

  /** Adds a game to the download queue without starting it. Returns immediately. */
  async queueDownload(romId: number): Promise<void> {
    const rom = await this.deps.getRomSource().getRom(romId);
    const plan = planRomFiles(rom, this.deps.paths);
    if (await isPlanDownloaded(plan)) return;
    // Failures show up on the job in the downloads list rather than here.
    void this.deps.downloads
      .enqueue({ romId, name: displayName(rom), files: plan.downloads })
      .catch(() => undefined);
  }

  /** Removes a game from the cache. Saves and states are kept. */
  async deleteLocal(romId: number): Promise<void> {
    if (this.isBusy && 'romId' in this.state && this.state.romId === romId) {
      throw new LauncherError('busy', 'This game is starting or running.');
    }
    const rom = await this.deps.getRomSource().getRom(romId);
    this.deps.downloads.cancel(romId);
    await removeFromCache(planRomFiles(rom, this.deps.paths));
  }

  async isDownloaded(rom: RomFilesSource): Promise<boolean> {
    try {
      return await isPlanDownloaded(planRomFiles(rom, this.deps.paths));
    } catch {
      return false;
    }
  }

  private block(romId: number, block: LaunchBlock): void {
    this.setState({ phase: 'blocked', romId, block });
  }

  private async ensureDownloaded(rom: LaunchableRom, plan: RomFilePlan): Promise<void> {
    if (await isPlanDownloaded(plan)) return;

    const totalBytes = plan.downloads.reduce((total, file) => total + file.sizeBytes, 0);
    const progress = { phase: 'downloading', romId: rom.id } as const;
    this.setState({ ...progress, receivedBytes: 0, totalBytes });

    // The queue reports progress for every job; mirror this game's into the launch state.
    const timer = setInterval(() => {
      const job = this.deps.downloads.list().find((candidate) => candidate.romId === rom.id);
      if (job && this.state.phase === 'downloading') {
        this.setState({ ...progress, receivedBytes: job.receivedBytes, totalBytes });
      }
    }, 250);
    try {
      await this.deps.downloads.enqueue(
        { romId: rom.id, name: displayName(rom), files: plan.downloads },
        { priority: true },
      );
    } finally {
      clearInterval(timer);
    }
  }

  private async requireRetroArch(): Promise<RetroArchInstall> {
    const install = await this.locateInstall();
    if (install) return install;
    throw new LauncherError(
      'retroarch_not_found',
      'RetroArch was not found. Open Settings → RetroArch to set it up or choose its location.',
    );
  }

  /** The core to run the game with, or null when the launch stopped to offer a download. */
  private async prepareCore(
    rom: LaunchableRom,
    install: RetroArchInstall,
    request: PlayRequest,
  ): Promise<string | null> {
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
        `No RetroArch core is set up for ${platform} yet. Choose one in Settings, under Cores.`,
      );
    }
    const { installCore } = this.deps;
    if (installCore && canDownloadCores(install)) {
      if (!request.installCore) {
        this.block(rom.id, { type: 'core', platformName: platform, cores: resolution.candidates });
        return null;
      }
      this.setState({ phase: 'installing-core', romId: rom.id });
      const core = await installCore(resolution.candidates, install);
      this.setState({ phase: 'starting', romId: rom.id });
      return core;
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
    plan: RomFilePlan,
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
    writeFileAtomicSync(
      paths.launchConfigFile,
      buildLaunchConfig({
        savesDir,
        statesDir,
        hideTouchOverlay: settings.hideTouchOverlay,
        extra: await this.deps.getControllerSettings(),
      }),
    );

    const romPath = await resolveLaunchTarget(plan);
    await touchPlan(plan);

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
      void this.finishSession(rom, core, plan, exitCode, playedSeconds);
    });
  }

  private async finishSession(
    rom: LaunchableRom,
    core: string,
    plan: RomFilePlan,
    exitCode: number | null,
    playedSeconds: number,
  ): Promise<void> {
    // RetroArch has closed its files, so whatever it wrote can go to the server now.
    this.setState({ phase: 'syncing', romId: rom.id, stage: 'after-exit' });
    const sync = await this.deps.syncSaves(rom, emulatorName(core));

    try {
      const removed = await enforceCachePolicy(
        this.deps.paths.romCacheDir,
        this.deps.getSettings().cache,
        plan.rootPath,
      );
      if (removed.length > 0) log.info(`Cache policy removed ${removed.length} game(s)`);
    } catch (error) {
      log.warn('Could not apply the cache policy', error);
    }

    this.setState({ phase: 'exited', romId: rom.id, exitCode, playedSeconds, sync });
  }

  private setState(state: LaunchState): void {
    this.state = state;
    this.deps.onStateChanged(state);
  }
}

function displayName(rom: LaunchableRom): string {
  return rom.name ?? rom.fs_name;
}

/** RomM labels saves with the core name without the libretro suffix. */
export function emulatorName(core: string): string {
  return core.replace(/_libretro$/, '');
}

/** Steam installs its cores as DLC; anything else can take a downloaded core. */
export function canDownloadCores(install: RetroArchInstall): boolean {
  return install.kind === 'standalone' && buildbotPlatform() !== null;
}
