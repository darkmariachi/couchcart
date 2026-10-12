import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  IpcEvents,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult,
  LauncherApi,
} from '../shared/ipc';

function call<C extends IpcChannel>(channel: C) {
  return (request?: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>> =>
    ipcRenderer.invoke(channel, request);
}

function subscribe<E extends keyof IpcEvents>(channel: E) {
  return (listener: (payload: IpcEvents[E]) => void) => {
    const handler = (_event: IpcRendererEvent, payload: IpcEvents[E]) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

// Named methods only: the renderer cannot reach ipcRenderer or pick arbitrary channels.
const api: LauncherApi = {
  server: { probe: call('server:probe') },
  auth: {
    status: call('auth:status'),
    login: call('auth:login'),
    logout: call('auth:logout'),
  },
  library: {
    platforms: call('library:platforms'),
    roms: call('library:roms'),
    romAssets: call('library:romAssets'),
  },
  debug: { apiProbe: call('debug:apiProbe') },
  retroarch: { status: call('retroarch:status') },
  game: {
    play: call('game:play'),
    state: call('game:state'),
    onStateChanged: subscribe('game:stateChanged'),
  },
};

contextBridge.exposeInMainWorld('romm', api);
