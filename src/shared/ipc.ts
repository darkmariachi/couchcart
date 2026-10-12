// The single source of truth for everything that crosses the main <-> renderer boundary.
import type { components } from '../main/romm/schema';
import type { SyncAction } from '../main/saves/syncDecision';

type Schemas = components['schemas'];
export type RommSave = Schemas['SaveSchema'];
export type RommState = Schemas['StateSchema'];

export interface ServerInfo {
  version: string;
}

export interface AuthStatus {
  serverUrl: string | null;
  username: string | null;
  loggedIn: boolean;
  /** False when the OS keychain is unavailable; the session then lasts only until exit. */
  credentialsPersisted: boolean;
}

export interface LoginRequest {
  serverUrl: string;
  username: string;
  password: string;
}

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
  /** Whether the ROM file is in the local cache. */
  downloaded: boolean;
}

export interface RomDetail extends RomSummary {
  platformName: string;
  description: string | null;
  releaseYear: number | null;
  genres: string[];
  coverLargePath: string | null;
  lastSync: SyncReport | null;
}

export interface PlatformCoverage {
  slug: string;
  name: string;
  romCount: number;
  /** The installed core that will run this platform, or null when none is. */
  core: string | null;
  /** Cores that would work if installed; empty when the platform is not mapped at all. */
  candidates: string[];
}

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

export interface RomQuery {
  platformId: number;
  search?: string;
  offset: number;
  limit: number;
}

export interface RomPage {
  items: RomSummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface RomAssets {
  saves: RommSave[];
  states: RommState[];
}

export interface ProbeFinding {
  question: string;
  answer: string;
  evidence: string[];
}

export interface RetroArchStatus {
  found: boolean;
  executablePath: string | null;
  kind: 'steam' | 'standalone' | null;
  version: string | null;
  coresDir: string | null;
  installedCores: string[];
}

export type SyncKind = 'save' | 'state';

export interface SyncItemResult {
  kind: SyncKind;
  fileName: string;
  action: SyncAction;
  /** `conflict` means both versions were left untouched and the user has to choose. */
  outcome: 'done' | 'conflict' | 'failed';
  detail: string;
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

export type LaunchState =
  | { phase: 'idle' }
  | { phase: 'downloading'; romId: number; receivedBytes: number; totalBytes: number }
  | { phase: 'starting'; romId: number }
  | { phase: 'syncing'; romId: number; stage: 'before-launch' | 'after-exit' }
  | { phase: 'running'; romId: number; core: string; startedAt: string }
  | {
      phase: 'exited';
      romId: number;
      exitCode: number | null;
      playedSeconds: number;
      sync: SyncReport;
    }
  | { phase: 'failed'; romId: number; error: IpcErrorInfo };

export interface IpcContract {
  'server:probe': { request: string; response: ServerInfo };
  'auth:status': { request: undefined; response: AuthStatus };
  'auth:login': { request: LoginRequest; response: AuthStatus };
  'auth:logout': { request: undefined; response: AuthStatus };
  'library:platforms': { request: undefined; response: PlatformSummary[] };
  'library:roms': { request: RomQuery; response: RomPage };
  'library:romAssets': { request: number; response: RomAssets };
  'library:platformRoms': { request: number; response: RomSummary[] };
  'library:recentlyPlayed': { request: undefined; response: RomSummary[] };
  'library:romDetail': { request: number; response: RomDetail };
  'library:coreCoverage': { request: undefined; response: PlatformCoverage[] };
  'debug:apiProbe': { request: undefined; response: ProbeFinding[] };
  'retroarch:status': { request: undefined; response: RetroArchStatus };
  /** Resolves once RetroArch is running; later changes arrive as `game:stateChanged`. */
  'game:play': { request: number; response: undefined };
  'game:state': { request: undefined; response: LaunchState };
  /** Downloads into the cache without launching. */
  'game:download': { request: number; response: undefined };
  'game:deleteLocal': { request: number; response: undefined };
  'setup:status': { request: undefined; response: SetupStatus };
  /** Opens a folder picker; resolves with the (possibly unchanged) status. */
  'setup:chooseCacheDir': { request: undefined; response: SetupStatus };
  'setup:importPreview': { request: undefined; response: ImportPreview };
  'setup:importSaves': { request: undefined; response: number };
  'setup:complete': { request: undefined; response: SetupStatus };
  'app:quit': { request: undefined; response: undefined };
  'app:toggleFullscreen': { request: undefined; response: undefined };
  'saves:sync': { request: number; response: SyncReport };
  'saves:lastReport': { request: number; response: SyncReport | null };
  'saves:resolveConflict': { request: ConflictResolution; response: SyncReport };
}

/** Pushed from main to renderer, without a request. */
export interface IpcEvents {
  'game:stateChanged': LaunchState;
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

/** The API the preload script exposes as `window.romm`. */
export interface LauncherApi {
  server: { probe: Call<'server:probe'> };
  auth: {
    status: Call<'auth:status'>;
    login: Call<'auth:login'>;
    logout: Call<'auth:logout'>;
  };
  library: {
    platforms: Call<'library:platforms'>;
    roms: Call<'library:roms'>;
    romAssets: Call<'library:romAssets'>;
    platformRoms: Call<'library:platformRoms'>;
    recentlyPlayed: Call<'library:recentlyPlayed'>;
    romDetail: Call<'library:romDetail'>;
    coreCoverage: Call<'library:coreCoverage'>;
  };
  setup: {
    status: Call<'setup:status'>;
    chooseCacheDir: Call<'setup:chooseCacheDir'>;
    importPreview: Call<'setup:importPreview'>;
    importSaves: Call<'setup:importSaves'>;
    complete: Call<'setup:complete'>;
  };
  app: { quit: Call<'app:quit'>; toggleFullscreen: Call<'app:toggleFullscreen'> };
  debug: { apiProbe: Call<'debug:apiProbe'> };
  retroarch: { status: Call<'retroarch:status'> };
  saves: {
    sync: Call<'saves:sync'>;
    lastReport: Call<'saves:lastReport'>;
    resolveConflict: Call<'saves:resolveConflict'>;
  };
  game: {
    play: Call<'game:play'>;
    state: Call<'game:state'>;
    download: Call<'game:download'>;
    deleteLocal: Call<'game:deleteLocal'>;
    /** Returns a function that removes the listener. */
    onStateChanged: (listener: (state: LaunchState) => void) => () => void;
  };
}
