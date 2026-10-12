import { spawn } from 'node:child_process';
import { readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AuthStatus,
  ConflictResolution,
  ControllerInfo,
  DownloadJob,
  FolderSetting,
  ImportPreview,
  LaunchState,
  LoginRequest,
  PlatformCoreSetting,
  PlatformCoverage,
  PlatformSummary,
  PlayRequest,
  ProbeFinding,
  RetroArchStatus,
  RomAssets,
  RomDetail,
  RomPage,
  RomQuery,
  RomSummary,
  ServerInfo,
  SettingsPatch,
  SettingsView,
  SetupStatus,
  SyncAllResult,
  SyncReport,
} from '../shared/ipc';
import { cacheSizeBytes } from './downloads/cacheJanitor';
import { DownloadManager } from './downloads/downloadManager';
import {
  ControllerDetector,
  assignPlayers,
  buildControllerSettings,
  toControllerInfo,
} from './launcher/controllers';
import { DEFAULT_CORES, listInstalledCores, resolveCore } from './launcher/cores';
import { LaunchService, emulatorName, type LaunchableRom } from './launcher/launchService';
import { locateRetroArch, type LocateOptions, type RetroArchInstall } from './launcher/retroarch';
import type { CoverSource } from './library/coverProtocol';
import { log } from './logging/logger';
import { DataPaths, safeSegment } from './paths';
import { AuthSession } from './romm/auth';
import { createAuthenticatedFetch } from './romm/authenticatedFetch';
import {
  RommClient,
  normalizeServerUrl,
  probeServer,
  type DetailedRom,
  type Platform,
  type SimpleRom,
} from './romm/client';
import { CredentialStore, type Encryptor } from './romm/credentials';
import { NetworkError, NotAuthenticatedError } from './romm/errors';
import { runApiProbe } from './romm/probe';
import { SaveBackups } from './saves/backups';
import {
  findImportCandidates,
  importCandidates,
  readRetroArchSaveDirs,
  toPreview,
  type ImportCandidate,
} from './saves/saveImport';
import { SaveSyncService } from './saves/saveSyncService';
import { SyncStore } from './saves/syncStore';
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
  onDownloadsChanged: (jobs: DownloadJob[]) => void;
  onOnlineChanged: (online: boolean) => void;
  /** Things only the Electron shell can do. */
  shell: {
    choosePath: (kind: 'directory' | 'file', startIn: string) => Promise<string | null>;
    quit: () => void;
    toggleFullscreen: () => void;
  };
}

/** What one platform's cache folder holds: file sizes, or `dir` for a multi-file game. */
type CachedFiles = Map<string, number | 'dir'>;

/** A game as listed, before facts about this PC (downloaded, sync status) are added. */
type ListedRom = Omit<RomSummary, 'downloaded' | 'syncStatus'>;

const RETRO_ARCH_LOOKUP_TTL_MS = 5 * 60_000;
const PENDING_SYNC_INTERVAL_MS = 2 * 60_000;

/** Owns the main-process services and implements what the IPC layer exposes. */
export class LauncherApp {
  private readonly settings: SettingsStore;
  private readonly credentials: CredentialStore;
  private readonly syncStore: SyncStore;
  private readonly paths: DataPaths;
  private readonly downloads: DownloadManager;
  private readonly saveSync: SaveSyncService;
  private readonly launcher: LaunchService;
  private readonly controllers: ControllerDetector;
  private connection: Connection | null = null;
  private online = true;
  private retroArchLookup: { key: string; at: number; install: RetroArchInstall | null } | null =
    null;
  private pendingSyncTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: LauncherAppOptions) {
    const { dataDir } = options;
    this.settings = new SettingsStore(join(dataDir, 'settings.json'), options.hostname);
    this.credentials = new CredentialStore(join(dataDir, 'credentials.bin'), options.encryptor);
    this.paths = new DataPaths(dataDir, () => this.settings.get().cacheDir);
    this.syncStore = new SyncStore(join(dataDir, 'sync.db'));

    this.downloads = new DownloadManager(
      () => this.requireConnection().client,
      options.onDownloadsChanged,
    );
    this.saveSync = new SaveSyncService({
      getRemote: () => this.requireConnection().client,
      store: this.syncStore,
      backups: new SaveBackups(
        join(dataDir, 'save-backups'),
        () => this.settings.get().saveBackupCount,
      ),
      paths: this.paths,
      getDeviceId: () => this.ensureDeviceId(),
    });
    this.launcher = new LaunchService({
      getRomSource: () => ({
        getRom: (id) => this.getRomRecord(id),
        markPlayed: (id) => this.requireConnection().client.markPlayed(id),
      }),
      getSettings: () => this.settings.get(),
      paths: this.paths,
      downloads: this.downloads,
      syncSaves: (rom, emulator) => this.saveSync.syncRom(rom, emulator),
      getControllerSettings: () => this.getControllerSettings(),
      locateRetroArch: (lookup) => this.locateRetroArchCached(lookup),
      listInstalledCores,
      spawn,
      onStateChanged: options.onLaunchStateChanged,
    });
    this.controllers = new ControllerDetector(
      () => this.launcher.locateInstall(),
      join(dataDir, 'retroarch'),
    );

    const { serverUrl, username } = this.settings.get();
    if (serverUrl) this.connection = this.connect(serverUrl);
    if (serverUrl && username) this.syncStore.bindAccount(accountKey(serverUrl, username));
  }

  /** Background work that should not run in tests: controller detection, upload retries. */
  start(): void {
    void this.controllers.refresh();
    this.pendingSyncTimer = setInterval(
      () => void this.retryPendingSyncs(),
      PENDING_SYNC_INTERVAL_MS,
    );
    setTimeout(() => void this.retryPendingSyncs(), 10_000);
  }

  /** Stops background work and releases the database file. */
  stop(): void {
    if (this.pendingSyncTimer) clearInterval(this.pendingSyncTimer);
    this.syncStore.close();
  }

  // ---------- Account ----------

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
    this.setOnline(true);
    return this.status();
  }

  logout(): AuthStatus {
    this.connection?.auth.logout();
    this.settings.update({ username: null, deviceId: null });
    return this.status();
  }

  isOnline(): boolean {
    return this.online;
  }

  // ---------- Library ----------

  async listPlatforms(): Promise<PlatformSummary[]> {
    const platforms = await this.cached('platforms', async () =>
      (await this.requireConnection().client.listPlatforms())
        .filter((platform) => platform.rom_count > 0)
        .map(toPlatformSummary),
    );
    return [...platforms].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRoms(query: RomQuery): Promise<RomPage> {
    const fetchPage = async () => {
      const page = await this.requireConnection().client.listRoms(query);
      return { items: page.items.map(toListedRom), total: page.total ?? page.items.length };
    };
    // Search results are not worth remembering; plain pages are (the home screen shelves).
    const page = query.search
      ? await fetchPage()
      : await this.cached(`roms:${query.platformId}:${query.offset}:${query.limit}`, fetchPage);
    return {
      items: await this.withLocalFacts(page.items),
      total: page.total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  /** Every game of a platform. The grid sorts, filters and searches this list locally. */
  async listPlatformRoms(platformId: number): Promise<RomSummary[]> {
    const roms = await this.cached(`platformRoms:${platformId}`, async () => {
      const listed: ListedRom[] = [];
      for await (const rom of this.requireConnection().client.iterateRoms({ platformId })) {
        listed.push(toListedRom(rom));
      }
      return listed;
    });
    return this.withLocalFacts(roms);
  }

  async listRecentlyPlayed(): Promise<RomSummary[]> {
    const roms = await this.cached('recentlyPlayed', async () => {
      const page = await this.requireConnection().client.listRoms({
        playedOnly: true,
        limit: 100,
      });
      return page.items.map(toListedRom);
    });
    return (await this.withLocalFacts(roms))
      .filter((rom) => rom.lastPlayed !== null)
      .sort((a, b) => Date.parse(b.lastPlayed ?? '') - Date.parse(a.lastPlayed ?? ''))
      .slice(0, 20);
  }

  async getRomDetail(romId: number): Promise<RomDetail> {
    const rom = await this.getRomRecord(romId);
    const retroarch = await this.launcher.getRetroArchStatus();
    const installed = new Set(retroarch.installedCores);
    const { coreOverrides } = this.settings.get();
    const resolution = this.resolveCoreFor(rom, installed);

    return {
      ...toListedRom(rom),
      downloaded: await this.launcher.isDownloaded(rom),
      syncStatus: this.saveSync.getLastReport(romId)?.status ?? null,
      platformName: rom.platform_display_name,
      description: rom.summary,
      releaseYear: toYear(rom.metadatum.first_release_date),
      genres: rom.metadatum.genres ?? [],
      coverLargePath: rom.path_cover_large,
      lastSync: this.saveSync.getLastReport(romId),
      core: resolution.found ? resolution.core : null,
      coreOverride: coreOverrides.games[String(romId)] ?? null,
      coreOptions: coreOptionsFor(rom.platform_slug, rom.platform_fs_slug, installed),
    };
  }

  /** Which platforms in the library have an installed core to run them. */
  async getCoreCoverage(): Promise<PlatformCoverage[]> {
    const [platforms, retroarch] = await Promise.all([
      this.listPlatforms(),
      this.launcher.getRetroArchStatus(),
    ]);
    const installed = new Set(retroarch.installedCores);
    return platforms.map((platform) => {
      const resolution = this.resolvePlatformCore(platform, installed);
      return {
        slug: platform.slug,
        name: platform.name,
        romCount: platform.romCount,
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

  /** Lets the cover image handler fetch with the current session. */
  get coverSource(): CoverSource {
    return this.requireConnection().client;
  }

  // ---------- Playing and downloading ----------

  getRetroArchStatus(): Promise<RetroArchStatus> {
    return this.launcher.getRetroArchStatus();
  }

  async play(request: PlayRequest): Promise<undefined> {
    await this.launcher.play(request);
  }

  getLaunchState(): LaunchState {
    return this.launcher.getState();
  }

  async downloadRom(romId: number): Promise<undefined> {
    await this.launcher.queueDownload(romId);
  }

  async deleteLocalRom(romId: number): Promise<undefined> {
    await this.launcher.deleteLocal(romId);
  }

  setGameCore(romId: number, core: string | null): undefined {
    const { coreOverrides } = this.settings.get();
    const games = withEntry(coreOverrides.games, String(romId), core);
    this.settings.update({ coreOverrides: { ...coreOverrides, games } });
  }

  listDownloads(): DownloadJob[] {
    return this.downloads.list();
  }

  cancelDownload(romId: number): undefined {
    this.downloads.cancel(romId);
  }

  clearFinishedDownloads(): undefined {
    this.downloads.clearFinished();
  }

  // ---------- Saves ----------

  async syncSaves(romId: number): Promise<SyncReport> {
    const rom = await this.getRomRecord(romId);
    return this.saveSync.syncRom(rom, await this.emulatorFor(rom));
  }

  getLastSyncReport(romId: number): SyncReport | null {
    return this.saveSync.getLastReport(romId);
  }

  async resolveConflict(resolution: ConflictResolution): Promise<SyncReport> {
    const rom = await this.getRomRecord(resolution.romId);
    return this.saveSync.resolveConflict(rom, resolution, await this.emulatorFor(rom));
  }

  /** Syncs every game this PC has save data for. */
  async syncAllSaves(): Promise<SyncAllResult> {
    const result: SyncAllResult = { games: 0, synced: 0, conflicts: 0, failed: 0 };
    for await (const rom of this.requireConnection().client.iterateRoms()) {
      if (!(await this.saveSync.hasSyncableData(rom))) continue;
      const report = await this.saveSync.syncRom(rom, await this.emulatorFor(rom));
      result.games++;
      if (report.status === 'synced') result.synced++;
      else if (report.status === 'conflict') result.conflicts++;
      else result.failed++;
    }
    return result;
  }

  // ---------- Controllers ----------

  async listControllers(): Promise<ControllerInfo[]> {
    return this.describeControllers(await this.controllers.current());
  }

  async detectControllers(): Promise<ControllerInfo[]> {
    return this.describeControllers(await this.controllers.refresh());
  }

  /** Makes a controller player 1; the others keep their relative order. */
  async setPlayerOne(signature: string): Promise<ControllerInfo[]> {
    const settings = this.settings.get().controllers;
    const playerOrder = [signature, ...settings.playerOrder.filter((other) => other !== signature)];
    this.settings.update({ controllers: { ...settings, playerOrder } });
    return this.listControllers();
  }

  private describeControllers(
    detected: Awaited<ReturnType<ControllerDetector['current']>>,
  ): ControllerInfo[] {
    return toControllerInfo(detected, this.settings.get().controllers.playerOrder);
  }

  private async getControllerSettings(): Promise<Record<string, string>> {
    const { playerOrder, menuCombo, quitCombo } = this.settings.get().controllers;
    const players = assignPlayers(await this.controllers.current(), playerOrder);
    return buildControllerSettings(players, { menu: menuCombo, quit: quitCombo });
  }

  // ---------- Settings and setup ----------

  async getSettingsView(): Promise<SettingsView> {
    const settings = this.settings.get();
    const [retroarch, install, usedBytes, freeBytes] = await Promise.all([
      this.launcher.getRetroArchStatus(),
      this.launcher.locateInstall(),
      cacheSizeBytes(this.paths.romCacheDir),
      freeBytesAt(this.paths.romCacheDir),
    ]);
    const installed = new Set(retroarch.installedCores);

    // Core settings need the platform list, which may be unavailable (logged out, offline).
    const platforms = await this.listPlatforms().catch(() => []);
    const platformCores: PlatformCoreSetting[] = platforms.map((platform) => {
      const resolution = this.resolvePlatformCore(platform, installed);
      return {
        slug: platform.slug,
        name: platform.name,
        core: resolution.found ? resolution.core : null,
        override: settings.coreOverrides.platforms[platform.slug] ?? null,
        options: coreOptionsFor(platform.slug, platform.fsSlug, installed),
      };
    });

    return {
      serverUrl: settings.serverUrl,
      username: settings.username,
      deviceName: settings.deviceName,
      saveBackupCount: settings.saveBackupCount,
      launcherFullscreen: settings.launcherFullscreen,
      retroarch: {
        configuredPath: settings.retroarch.executablePath,
        detectedPath: install?.executablePath ?? null,
        version: install?.version ?? null,
        configuredCoresDir: settings.retroarch.coresDir,
        coresDir: install?.coresDir ?? null,
        fullscreen: settings.retroarch.fullscreen,
        extraArgs: settings.retroarch.extraArgs.join(' '),
      },
      cache: {
        dir: this.paths.romCacheDir,
        keep: settings.cache.keep,
        limitGb: settings.cache.limitGb,
        usedBytes,
        freeBytes,
      },
      controllers: {
        menuCombo: settings.controllers.menuCombo,
        quitCombo: settings.controllers.quitCombo,
      },
      platformCores,
    };
  }

  async updateSettings(patch: SettingsPatch): Promise<SettingsView> {
    const current = this.settings.get();
    const retroarch = { ...current.retroarch };
    if (patch.retroarchFullscreen !== undefined) retroarch.fullscreen = patch.retroarchFullscreen;
    if (patch.retroarchExtraArgs !== undefined) {
      retroarch.extraArgs = patch.retroarchExtraArgs.split(/\s+/).filter(Boolean);
    }
    if (patch.retroarchPath !== undefined) retroarch.executablePath = patch.retroarchPath;
    if (patch.coresDir !== undefined) retroarch.coresDir = patch.coresDir;

    const platforms = patch.platformCore
      ? withEntry(current.coreOverrides.platforms, patch.platformCore.slug, patch.platformCore.core)
      : current.coreOverrides.platforms;

    this.settings.update({
      deviceName: patch.deviceName ?? current.deviceName,
      saveBackupCount: patch.saveBackupCount ?? current.saveBackupCount,
      launcherFullscreen: patch.launcherFullscreen ?? current.launcherFullscreen,
      retroarch,
      cache: {
        keep: patch.cacheKeep ?? current.cache.keep,
        limitGb: patch.cacheLimitGb ?? current.cache.limitGb,
      },
      controllers: {
        ...current.controllers,
        menuCombo: patch.menuCombo ?? current.controllers.menuCombo,
        quitCombo: patch.quitCombo ?? current.controllers.quitCombo,
      },
      coreOverrides: { ...current.coreOverrides, platforms },
    });

    if (patch.retroarchPath !== undefined || patch.coresDir !== undefined) {
      this.retroArchLookup = null;
      void this.controllers.refresh();
    }
    return this.getSettingsView();
  }

  /** Opens a picker for one of the path settings and applies what the user chose. */
  async chooseSettingPath(setting: FolderSetting): Promise<SettingsView> {
    const { shell } = this.options;
    if (setting === 'cache') {
      const chosen = await shell.choosePath('directory', dirname(this.paths.romCacheDir));
      if (chosen) this.settings.update({ cacheDir: chosen });
      return this.getSettingsView();
    }

    const install = await this.launcher.locateInstall();
    const startIn = install?.workingDir ?? this.options.dataDir;
    const chosen = await shell.choosePath(setting === 'retroarch' ? 'file' : 'directory', startIn);
    if (!chosen) return this.getSettingsView();
    return this.updateSettings(
      setting === 'retroarch' ? { retroarchPath: chosen } : { coresDir: chosen },
    );
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
    await this.chooseSettingPath('cache');
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

  get launcherFullscreen(): boolean {
    return this.settings.get().launcherFullscreen;
  }

  // ---------- Internals ----------

  /**
   * Runs a library request and remembers the answer. When the server cannot be reached,
   * the remembered answer is returned instead, so the app keeps working offline.
   */
  private async cached<T>(key: string, request: () => Promise<T>): Promise<T> {
    try {
      const value = await request();
      this.syncStore.putCache(key, value);
      this.setOnline(true);
      return value;
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      this.setOnline(false);
      const remembered = this.syncStore.getCache<T>(key);
      if (remembered === null) throw error;
      return remembered;
    }
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    log.info(online ? 'RomM server reachable again' : 'RomM server unreachable; working offline');
    this.options.onOnlineChanged(online);
    if (online) void this.retryPendingSyncs();
  }

  /** The full server record of a game; remembered so downloaded games start offline. */
  private getRomRecord(romId: number): Promise<DetailedRom> {
    return this.cached(`rom:${romId}`, () => this.requireConnection().client.getRom(romId));
  }

  /** Uploads progress that could not be synced earlier (played offline, server hiccup). */
  private async retryPendingSyncs(): Promise<void> {
    if (!this.connection?.auth.isLoggedIn || this.launcher.isBusy) return;
    const pending = [...this.syncStore.listReportStatuses()]
      .filter(([, status]) => status === 'offline' || status === 'error')
      .map(([romId]) => romId);
    if (pending.length === 0) return;

    for (const romId of pending) {
      if (this.launcher.isBusy) return;
      try {
        const report = await this.syncSaves(romId);
        if (report.status === 'offline') return; // still unreachable; try again later
      } catch (error) {
        log.warn(`Retrying save sync for ROM ${romId} failed`, error);
      }
    }
    // A successful request is what tells us the server is back.
    await this.listPlatforms().catch(() => undefined);
  }

  /** `retroarch --version` is slow to run, so a recent answer is reused. */
  private async locateRetroArchCached(lookup: LocateOptions): Promise<RetroArchInstall | null> {
    const key = JSON.stringify(lookup);
    const known = this.retroArchLookup;
    if (known?.key === key && known.install && Date.now() - known.at < RETRO_ARCH_LOOKUP_TTL_MS) {
      return known.install;
    }
    const install = await locateRetroArch(lookup);
    this.retroArchLookup = { key, at: Date.now(), install };
    return install;
  }

  private resolveCoreFor(rom: LaunchableRom, installed: Set<string>) {
    return resolveCore({
      romId: rom.id,
      platformSlug: rom.platform_slug,
      platformFsSlug: rom.platform_fs_slug,
      overrides: this.settings.get().coreOverrides,
      defaults: DEFAULT_CORES,
      installed,
    });
  }

  private resolvePlatformCore(platform: PlatformSummary, installed: Set<string>) {
    return resolveCore({
      romId: 0,
      platformSlug: platform.slug,
      platformFsSlug: platform.fsSlug,
      overrides: { platforms: this.settings.get().coreOverrides.platforms, games: {} },
      defaults: DEFAULT_CORES,
      installed,
    });
  }

  /** The core that would run this game, as the emulator label for uploads. */
  private async emulatorFor(rom: LaunchableRom): Promise<string | null> {
    const status = await this.launcher.getRetroArchStatus();
    const resolution = this.resolveCoreFor(rom, new Set(status.installedCores));
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

  private async findImportCandidates(): Promise<ImportCandidate[]> {
    const install = await this.launcher.locateInstall();
    if (!install) return [];
    const roms: SimpleRom[] = [];
    for await (const rom of this.requireConnection().client.iterateRoms()) roms.push(rom);
    const sourceDirs = await readRetroArchSaveDirs(install.workingDir);
    return findImportCandidates(sourceDirs, roms, this.paths);
  }

  /** Adds what only this PC knows: whether a game is downloaded and its sync status. */
  private async withLocalFacts(roms: ListedRom[]): Promise<RomSummary[]> {
    const syncStatuses = this.syncStore.listReportStatuses();
    const cacheByPlatform = new Map<string, CachedFiles>();
    const summaries: RomSummary[] = [];
    for (const rom of roms) {
      let cached = cacheByPlatform.get(rom.platformSlug);
      if (!cached) {
        cached = await this.listCachedFiles(rom.platformSlug);
        cacheByPlatform.set(rom.platformSlug, cached);
      }
      summaries.push({
        ...rom,
        downloaded: isCached(rom, cached),
        syncStatus: syncStatuses.get(rom.id) ?? null,
      });
    }
    return summaries;
  }

  private async listCachedFiles(platformSlug: string): Promise<CachedFiles> {
    const files: CachedFiles = new Map();
    try {
      const dir = join(this.paths.romCacheDir, safeSegment(platformSlug));
      for (const name of await readdir(dir)) {
        const info = await stat(join(dir, name));
        files.set(name, info.isDirectory() ? 'dir' : info.size);
      }
    } catch {
      // Nothing downloaded for this platform yet.
    }
    return files;
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

/** A copy of `map` with `key` set to `value`, or removed when `value` is null. */
function withEntry(
  map: Record<string, string>,
  key: string,
  value: string | null,
): Record<string, string> {
  const others = Object.entries(map).filter(([existing]) => existing !== key);
  return Object.fromEntries(value === null ? others : [...others, [key, value]]);
}

function accountKey(serverUrl: string, username: string): string {
  return `${serverUrl}|${username}`;
}

/** Installed cores that can run a platform, in order of preference. */
function coreOptionsFor(slug: string, fsSlug: string, installed: Set<string>): string[] {
  const known = DEFAULT_CORES[slug] ?? DEFAULT_CORES[fsSlug] ?? [];
  return known.filter((core) => installed.has(core));
}

/**
 * In lists, a multi-file game counts as downloaded when its folder exists; the exact
 * per-file check happens on its own page and before launching.
 */
function isCached(rom: ListedRom, cached: CachedFiles): boolean {
  try {
    const entry = cached.get(safeSegment(rom.fileName));
    return rom.hasMultipleFiles ? entry === 'dir' : entry === rom.sizeBytes;
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

function toPlatformSummary(platform: Platform): PlatformSummary {
  return {
    id: platform.id,
    slug: platform.slug,
    fsSlug: platform.fs_slug,
    name: platform.display_name,
    romCount: platform.rom_count,
  };
}

function toListedRom(rom: SimpleRom): ListedRom {
  return {
    id: rom.id,
    name: rom.name ?? rom.fs_name_no_ext,
    fileName: rom.fs_name,
    sizeBytes: rom.fs_size_bytes,
    platformSlug: rom.platform_slug,
    coverPath: rom.path_cover_small,
    lastPlayed: rom.rom_user.last_played,
    hasMultipleFiles: !rom.has_simple_single_file,
    md5: rom.md5_hash,
    createdAt: rom.created_at,
  };
}
