// The single source of truth for everything that crosses the main <-> renderer boundary.
import type { SyncAction } from '../main/saves/syncDecision';

// ---------- Account and server ----------

export interface ServerInfo {
  version: string;
}

/** A RomM server found on the local network. */
export interface DiscoveredServer {
  url: string;
  version: string;
}

export interface AuthStatus {
  serverUrl: string | null;
  username: string | null;
  loggedIn: boolean;
  /** False when the OS keychain is unavailable; the session then lasts only until exit. */
  credentialsPersisted: boolean;
}

/** What to show the user while a pairing waits for their approval. */
export interface PairingInfo {
  userCode: string;
  /** Page of the RomM web UI where the code is entered. */
  verificationUrl: string;
  /** The same page with the code filled in, for a QR code. */
  completeUrl: string;
  expiresAt: string;
  intervalSeconds: number;
}

export type PairingStatus =
  | { state: 'pending' }
  | { state: 'approved'; auth: AuthStatus }
  | { state: 'denied' }
  | { state: 'expired' }
  /** No pairing is in progress. */
  | { state: 'none' };

export interface LoginRequest {
  serverUrl: string;
  username: string;
  password: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  /** The app that registered it, e.g. this launcher or RomM's web player. */
  client: string | null;
  platform: string | null;
  lastSeen: string | null;
  isThisDevice: boolean;
}

/** What the Account screen shows. Parts the server could not provide are null or empty. */
export interface AccountOverview {
  username: string | null;
  role: string | null;
  serverUrl: string | null;
  serverVersion: string | null;
  launcherVersion: string;
  deviceName: string;
  stats: {
    games: number;
    platforms: number;
    saves: number;
    states: number;
    screenshots: number;
    totalBytes: number;
  } | null;
  devices: DeviceInfo[];
}

// ---------- Library ----------

export interface PlatformSummary {
  id: number;
  slug: string;
  fsSlug: string;
  name: string;
  romCount: number;
}

export interface RomSummary {
  id: number;
  name: string;
  fileName: string;
  sizeBytes: number;
  platformSlug: string;
  coverPath: string | null;
  lastPlayed: string | null;
  hasMultipleFiles: boolean;
  md5: string | null;
  createdAt: string;
  /** Whether the game's files are in the local cache. */
  downloaded: boolean;
  /** Result of the last save sync on this PC; null when it never ran. */
  syncStatus: SyncReport['status'] | null;
}

export interface RomDetail extends RomSummary {
  platformName: string;
  description: string | null;
  releaseYear: number | null;
  genres: string[];
  coverLargePath: string | null;
  lastSync: SyncReport | null;
  /** The core that will run this game, or null when none is installed. */
  core: string | null;
  /** A core chosen for this game specifically; null means "use the platform's". */
  coreOverride: string | null;
  /** Installed cores that can run this platform. */
  coreOptions: string[];
  favorite: boolean;
  screenshots: string[];
  regions: string[];
  languages: string[];
  companies: string[];
  /** Average critic/user rating out of 100, when a metadata source provides one. */
  rating: number | null;
  playerCount: string | null;
}

export type CollectionKind = 'regular' | 'smart' | 'virtual';

export interface CollectionSummary {
  kind: CollectionKind;
  /** Unique together with `kind`. */
  id: string;
  name: string;
  description: string;
  romCount: number;
  /** A few game covers to show as the collection's artwork. */
  coverPaths: string[];
  isFavorites: boolean;
}

/** What a grid of games is showing. */
export type GridSource =
  | { type: 'platform'; platformId: number }
  | { type: 'collection'; kind: CollectionKind; id: string }
  | { type: 'search'; term: string };

export interface PlatformCoverage {
  slug: string;
  name: string;
  romCount: number;
  /** The installed core that will run this platform, or null when none is. */
  core: string | null;
  /** Cores that would work if installed; empty when the platform is not mapped at all. */
  candidates: string[];
}

// ---------- Setup and settings ----------

export interface SetupStatus {
  complete: boolean;
  deviceName: string;
  cacheDir: string;
  /** Free space on the cache folder's drive, when it can be determined. */
  freeBytes: number | null;
  fullscreen: boolean;
}

/** Saves found in RetroArch's own folders that match games in the library. */
export interface ImportPreview {
  saves: number;
  states: number;
  games: string[];
}

/** What happens to a downloaded game after you stop playing it. */
export type CacheKeepMode = 'always' | 'limit' | 'never';

/** `keep` leaves whatever is set in RetroArch itself untouched. */
export type GamepadCombo =
  'keep' | 'none' | 'hold_start' | 'hold_select' | 'start_select' | 'l3_r3';

export interface PlatformCoreSetting {
  slug: string;
  name: string;
  /** The core in use right now (override or default), or null when none is installed. */
  core: string | null;
  override: string | null;
  /** Installed cores that can run this platform. */
  options: string[];
}

export interface SettingsView {
  serverUrl: string | null;
  username: string | null;
  deviceName: string;
  saveBackupCount: number;
  launcherFullscreen: boolean;
  retroarch: {
    /** Null means auto-detect. */
    configuredPath: string | null;
    detectedPath: string | null;
    version: string | null;
    /** Null means the install's own cores folder. */
    configuredCoresDir: string | null;
    coresDir: string | null;
    fullscreen: boolean;
    hideTouchOverlay: boolean;
    extraArgs: string;
  };
  cache: {
    dir: string;
    keep: CacheKeepMode;
    limitGb: number;
    usedBytes: number;
    freeBytes: number | null;
  };
  controllers: {
    menuCombo: GamepadCombo;
    quitCombo: GamepadCombo;
  };
  platformCores: PlatformCoreSetting[];
}

/** Every field is optional: only what is present changes. */
export interface SettingsPatch {
  deviceName?: string;
  saveBackupCount?: number;
  launcherFullscreen?: boolean;
  retroarchFullscreen?: boolean;
  hideTouchOverlay?: boolean;
  retroarchExtraArgs?: string;
  /** Null returns to auto-detection. */
  retroarchPath?: string | null;
  coresDir?: string | null;
  cacheKeep?: CacheKeepMode;
  cacheLimitGb?: number;
  menuCombo?: GamepadCombo;
  quitCombo?: GamepadCombo;
  /** `core: null` removes the override. */
  platformCore?: { slug: string; core: string | null };
}

/** Pages the launcher can open; the renderer picks a name, never a URL. */
export type ExternalLink = 'retroarch-steam' | 'retroarch-website';

export type FolderSetting = 'cache' | 'retroarch' | 'cores';

export interface ControllerInfo {
  /** RetroArch's identity for the device: `vid:pid name`. */
  signature: string;
  name: string;
  /** False for devices RetroArch has no button layout for (they are ignored). */
  recognized: boolean;
  /** Player number it will be in the next game, or null when ignored. */
  player: number | null;
}

// ---------- RetroArch and launching ----------

export interface RetroArchStatus {
  found: boolean;
  executablePath: string | null;
  kind: 'steam' | 'standalone' | null;
  version: string | null;
  coresDir: string | null;
  installedCores: string[];
  /** True for the copy the launcher downloaded itself. */
  managed: boolean;
  /** The launcher can download RetroArch on this kind of PC. */
  canSetUp: boolean;
  /** Missing cores can be downloaded into this install. */
  canInstallCores: boolean;
}

/** Progress of a RetroArch or core download the user asked for. */
export interface SetupProgress {
  /** What is being fetched: "RetroArch" or a core's name. */
  item: string;
  stage: 'downloading' | 'unpacking';
  receivedBytes: number;
  totalBytes: number | null;
}

export interface CoreInstallResult {
  /** Cores that were installed. */
  installed: string[];
  /** Platforms that still have no core, with the reason. */
  failed: { platform: string; reason: string }[];
}

export type SyncKind = 'save' | 'state';

/** What is known about the two sides of a conflict, to help the user choose. */
export interface ConflictDetail {
  localModifiedAt: string | null;
  serverUpdatedAt: string | null;
  /** Name of the device that uploaded the server copy, when RomM knows it. */
  serverDevice: string | null;
}

export interface SyncItemResult {
  kind: SyncKind;
  fileName: string;
  action: SyncAction;
  /** `conflict` means both versions were left untouched and the user has to choose. */
  outcome: 'done' | 'conflict' | 'failed';
  detail: string;
  conflict?: ConflictDetail;
}

export interface SyncReport {
  romId: number;
  /** `offline`: the server could not be reached, nothing was changed. */
  status: 'synced' | 'conflict' | 'offline' | 'error';
  items: SyncItemResult[];
  at: string;
}

export interface ConflictResolution {
  romId: number;
  kind: SyncKind;
  fileName: string;
  /** Which version to keep. The other one goes to the backups folder. */
  keep: 'local' | 'server';
}

export interface SyncAllResult {
  games: number;
  synced: number;
  conflicts: number;
  failed: number;
}

/** Something the user has to decide before the game can start. */
export type LaunchBlock =
  | { type: 'conflict'; conflicts: SyncItemResult[] }
  | { type: 'bios'; platformName: string; missing: string[]; systemDir: string }
  /** No core is installed, and one of `cores` can be downloaded. */
  | { type: 'core'; platformName: string; cores: string[] };

export interface PlayRequest {
  romId: number;
  /** Start with this PC's saves even though the server has different ones. */
  ignoreConflicts?: boolean;
  /** Start even though required BIOS files appear to be missing. */
  ignoreMissingBios?: boolean;
  /** Download a core for the platform when none is installed. */
  installCore?: boolean;
}

export type LaunchState =
  | { phase: 'idle' }
  | { phase: 'downloading'; romId: number; receivedBytes: number; totalBytes: number }
  | { phase: 'starting'; romId: number }
  | { phase: 'installing-core'; romId: number }
  | { phase: 'syncing'; romId: number; stage: 'before-launch' | 'after-exit' }
  | { phase: 'blocked'; romId: number; block: LaunchBlock }
  | { phase: 'running'; romId: number; core: string; startedAt: string }
  | {
      phase: 'exited';
      romId: number;
      exitCode: number | null;
      playedSeconds: number;
      sync: SyncReport;
    }
  | { phase: 'failed'; romId: number; error: IpcErrorInfo };

export interface DownloadJob {
  romId: number;
  name: string;
  status: 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled';
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  error: string | null;
}

// ---------- Channels ----------

export interface IpcContract {
  'server:probe': { request: string; response: ServerInfo };
  /** Scans the local network for RomM servers on the default port (takes a few seconds). */
  'server:discover': { request: undefined; response: DiscoveredServer[] };
  'auth:status': { request: undefined; response: AuthStatus };
  'auth:login': { request: LoginRequest; response: AuthStatus };
  'auth:logout': { request: undefined; response: AuthStatus };
  /** Asks the server for a pairing code. The request is the server address. */
  'auth:startPairing': { request: string; response: PairingInfo };
  /** Checks whether the pairing was approved; signs in when it was. */
  'auth:pairingStatus': { request: undefined; response: PairingStatus };
  'auth:cancelPairing': { request: undefined; response: undefined };
  'account:overview': { request: undefined; response: AccountOverview };

  'library:platforms': { request: undefined; response: PlatformSummary[] };
  /** Every game of a platform, a collection or a search. */
  'library:gridRoms': { request: GridSource; response: RomSummary[] };
  'library:recentlyAdded': { request: undefined; response: RomSummary[] };
  'library:collections': { request: undefined; response: CollectionSummary[] };
  /** A few game names matching what has been typed, for search suggestions. */
  'library:suggest': { request: string; response: string[] };
  'library:recentlyPlayed': { request: undefined; response: RomSummary[] };
  'library:romDetail': { request: number; response: RomDetail };
  'library:coreCoverage': { request: undefined; response: PlatformCoverage[] };

  'retroarch:status': { request: undefined; response: RetroArchStatus };
  /** Downloads RetroArch into the launcher's own folder. Takes a few minutes. */
  'retroarch:setUp': { request: undefined; response: RetroArchStatus };
  /** Downloads a core for every platform in the library that has none. */
  'retroarch:installMissingCores': { request: undefined; response: CoreInstallResult };
  /**
   * Resolves once RetroArch is running, or once the launch is blocked on a decision;
   * later changes arrive as `game:stateChanged`.
   */
  'game:play': { request: PlayRequest; response: undefined };
  'game:state': { request: undefined; response: LaunchState };
  /** Adds the game to the download queue without launching it. */
  'game:download': { request: number; response: undefined };
  'game:deleteLocal': { request: number; response: undefined };
  /** `core: null` returns the game to its platform's core. */
  'game:setCore': { request: { romId: number; core: string | null }; response: undefined };
  'game:setFavorite': { request: { romId: number; favorite: boolean }; response: undefined };

  'downloads:list': { request: undefined; response: DownloadJob[] };
  'downloads:cancel': { request: number; response: undefined };
  'downloads:clearFinished': { request: undefined; response: undefined };

  'saves:sync': { request: number; response: SyncReport };
  'saves:lastReport': { request: number; response: SyncReport | null };
  'saves:resolveConflict': { request: ConflictResolution; response: SyncReport };
  'saves:syncAll': { request: undefined; response: SyncAllResult };

  'controllers:list': { request: undefined; response: ControllerInfo[] };
  /** Runs a fresh detection (takes several seconds). */
  'controllers:detect': { request: undefined; response: ControllerInfo[] };
  'controllers:setPlayerOne': { request: string; response: ControllerInfo[] };

  'settings:get': { request: undefined; response: SettingsView };
  'settings:update': { request: SettingsPatch; response: SettingsView };
  /** Opens a folder (or, for RetroArch, file) picker and applies the choice. */
  'settings:choosePath': { request: FolderSetting; response: SettingsView };

  'setup:status': { request: undefined; response: SetupStatus };
  /** Opens a folder picker; resolves with the (possibly unchanged) status. */
  'setup:chooseCacheDir': { request: undefined; response: SetupStatus };
  'setup:importPreview': { request: undefined; response: ImportPreview };
  'setup:importSaves': { request: undefined; response: number };
  'setup:complete': { request: undefined; response: SetupStatus };

  'app:online': { request: undefined; response: boolean };
  'app:quit': { request: undefined; response: undefined };
  'app:toggleFullscreen': { request: undefined; response: undefined };
  /** Puts the recent log on the clipboard; resolves with the number of lines copied. */
  'app:copyLogs': { request: undefined; response: number };
  'app:openLogsFolder': { request: undefined; response: undefined };
  /** Opens one of a fixed set of pages outside the launcher. */
  'app:openLink': { request: ExternalLink; response: undefined };
}

/** Pushed from main to renderer, without a request. */
export interface IpcEvents {
  'game:stateChanged': LaunchState;
  'downloads:changed': DownloadJob[];
  'retroarch:setupProgress': SetupProgress;
  /** False while the RomM server cannot be reached. */
  'app:onlineChanged': boolean;
}

export type IpcChannel = keyof IpcContract;
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response'];

export type IpcErrorCode =
  | 'not_authenticated'
  | 'session_expired'
  | 'network'
  | 'api'
  | 'invalid_input'
  | 'retroarch_not_found'
  | 'core_missing'
  | 'unsupported_rom'
  | 'busy'
  | 'cancelled'
  | 'download_failed'
  | 'launch_failed'
  | 'internal';

export interface IpcErrorInfo {
  code: IpcErrorCode;
  message: string;
  status?: number;
}

// Errors thrown inside ipcMain handlers lose their type on the way to the renderer, so
// every call resolves to an explicit result instead.
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcErrorInfo };

type Call<C extends IpcChannel> =
  IpcRequest<C> extends undefined
    ? () => Promise<IpcResult<IpcResponse<C>>>
    : (request: IpcRequest<C>) => Promise<IpcResult<IpcResponse<C>>>;

type Subscribe<E extends keyof IpcEvents> = (
  listener: (payload: IpcEvents[E]) => void,
) => () => void;

/** The API the preload script exposes as `window.romm`. */
export interface LauncherApi {
  server: { probe: Call<'server:probe'>; discover: Call<'server:discover'> };
  auth: {
    status: Call<'auth:status'>;
    login: Call<'auth:login'>;
    logout: Call<'auth:logout'>;
    startPairing: Call<'auth:startPairing'>;
    pairingStatus: Call<'auth:pairingStatus'>;
    cancelPairing: Call<'auth:cancelPairing'>;
  };
  account: { overview: Call<'account:overview'> };
  library: {
    platforms: Call<'library:platforms'>;
    gridRoms: Call<'library:gridRoms'>;
    recentlyAdded: Call<'library:recentlyAdded'>;
    collections: Call<'library:collections'>;
    suggest: Call<'library:suggest'>;
    recentlyPlayed: Call<'library:recentlyPlayed'>;
    romDetail: Call<'library:romDetail'>;
    coreCoverage: Call<'library:coreCoverage'>;
  };
  retroarch: {
    status: Call<'retroarch:status'>;
    setUp: Call<'retroarch:setUp'>;
    installMissingCores: Call<'retroarch:installMissingCores'>;
    onSetupProgress: Subscribe<'retroarch:setupProgress'>;
  };
  game: {
    play: Call<'game:play'>;
    state: Call<'game:state'>;
    download: Call<'game:download'>;
    deleteLocal: Call<'game:deleteLocal'>;
    setCore: Call<'game:setCore'>;
    setFavorite: Call<'game:setFavorite'>;
    /** Each `on...` returns a function that removes the listener. */
    onStateChanged: Subscribe<'game:stateChanged'>;
  };
  downloads: {
    list: Call<'downloads:list'>;
    cancel: Call<'downloads:cancel'>;
    clearFinished: Call<'downloads:clearFinished'>;
    onChanged: Subscribe<'downloads:changed'>;
  };
  saves: {
    sync: Call<'saves:sync'>;
    lastReport: Call<'saves:lastReport'>;
    resolveConflict: Call<'saves:resolveConflict'>;
    syncAll: Call<'saves:syncAll'>;
  };
  controllers: {
    list: Call<'controllers:list'>;
    detect: Call<'controllers:detect'>;
    setPlayerOne: Call<'controllers:setPlayerOne'>;
  };
  settings: {
    get: Call<'settings:get'>;
    update: Call<'settings:update'>;
    choosePath: Call<'settings:choosePath'>;
  };
  setup: {
    status: Call<'setup:status'>;
    chooseCacheDir: Call<'setup:chooseCacheDir'>;
    importPreview: Call<'setup:importPreview'>;
    importSaves: Call<'setup:importSaves'>;
    complete: Call<'setup:complete'>;
  };
  app: {
    online: Call<'app:online'>;
    quit: Call<'app:quit'>;
    toggleFullscreen: Call<'app:toggleFullscreen'>;
    copyLogs: Call<'app:copyLogs'>;
    openLogsFolder: Call<'app:openLogsFolder'>;
    openLink: Call<'app:openLink'>;
    onOnlineChanged: Subscribe<'app:onlineChanged'>;
  };
}
