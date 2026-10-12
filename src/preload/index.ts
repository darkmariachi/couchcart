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
    platformRoms: call('library:platformRoms'),
    recentlyPlayed: call('library:recentlyPlayed'),
    romDetail: call('library:romDetail'),
    coreCoverage: call('library:coreCoverage'),
  },
  retroarch: { status: call('retroarch:status') },
  game: {
    play: call('game:play'),
    state: call('game:state'),
    download: call('game:download'),
    deleteLocal: call('game:deleteLocal'),
    setCore: call('game:setCore'),
    onStateChanged: subscribe('game:stateChanged'),
  },
  downloads: {
    list: call('downloads:list'),
    cancel: call('downloads:cancel'),
    clearFinished: call('downloads:clearFinished'),
    onChanged: subscribe('downloads:changed'),
  },
  saves: {
    sync: call('saves:sync'),
    lastReport: call('saves:lastReport'),
    resolveConflict: call('saves:resolveConflict'),
    syncAll: call('saves:syncAll'),
  },
  controllers: {
    list: call('controllers:list'),
    detect: call('controllers:detect'),
    setPlayerOne: call('controllers:setPlayerOne'),
  },
  settings: {
    get: call('settings:get'),
    update: call('settings:update'),
    choosePath: call('settings:choosePath'),
  },
  setup: {
    status: call('setup:status'),
    chooseCacheDir: call('setup:chooseCacheDir'),
    importPreview: call('setup:importPreview'),
    importSaves: call('setup:importSaves'),
    complete: call('setup:complete'),
  },
  app: {
    online: call('app:online'),
    quit: call('app:quit'),
    toggleFullscreen: call('app:toggleFullscreen'),
    copyLogs: call('app:copyLogs'),
    openLogsFolder: call('app:openLogsFolder'),
    onOnlineChanged: subscribe('app:onlineChanged'),
  },
  debug: { apiProbe: call('debug:apiProbe') },
};

contextBridge.exposeInMainWorld('romm', api);
