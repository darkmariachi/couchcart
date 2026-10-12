import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcRequest, IpcResponse, IpcResult, LauncherApi } from '../shared/ipc';

function call<C extends IpcChannel>(channel: C) {
  return (request?: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>> =>
    ipcRenderer.invoke(channel, request);
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
};

contextBridge.exposeInMainWorld('romm', api);
