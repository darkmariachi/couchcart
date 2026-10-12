// The single source of truth for everything that crosses the main <-> renderer boundary.
import type { components } from '../main/romm/schema';

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

export type LaunchState =
  | { phase: 'idle' }
  | { phase: 'downloading'; romId: number; receivedBytes: number; totalBytes: number }
  | { phase: 'starting'; romId: number }
  | { phase: 'running'; romId: number; core: string; startedAt: string }
  | { phase: 'exited'; romId: number; exitCode: number | null; playedSeconds: number }
  | { phase: 'failed'; romId: number; error: IpcErrorInfo };

export interface IpcContract {
  'server:probe': { request: string; response: ServerInfo };
  'auth:status': { request: undefined; response: AuthStatus };
  'auth:login': { request: LoginRequest; response: AuthStatus };
  'auth:logout': { request: undefined; response: AuthStatus };
  'library:platforms': { request: undefined; response: PlatformSummary[] };
  'library:roms': { request: RomQuery; response: RomPage };
  'library:romAssets': { request: number; response: RomAssets };
  'debug:apiProbe': { request: undefined; response: ProbeFinding[] };
  'retroarch:status': { request: undefined; response: RetroArchStatus };
  /** Resolves once RetroArch is running; later changes arrive as `game:stateChanged`. */
  'game:play': { request: number; response: undefined };
  'game:state': { request: undefined; response: LaunchState };
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
  };
  debug: { apiProbe: Call<'debug:apiProbe'> };
  retroarch: { status: Call<'retroarch:status'> };
  game: {
    play: Call<'game:play'>;
    state: Call<'game:state'>;
    /** Returns a function that removes the listener. */
    onStateChanged: (listener: (state: LaunchState) => void) => () => void;
  };
}
