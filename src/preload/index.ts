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
  server: { probe: call('server:probe'), discover: call('server:discover') },
  auth: {
    status: call('auth:status'),
    login: call('auth:login'),
    logout: call('auth:logout'),
    startPairing: call('auth:startPairing'),
    pairingStatus: call('auth:pairingStatus'),
    cancelPairing: call('auth:cancelPairing'),
  },
  account: { overview: call('account:overview') },
  library: {
    platforms: call('library:platforms'),
    gridRoms: call('library:gridRoms'),
    recentlyAdded: call('library:recentlyAdded'),
    collections: call('library:collections'),
    suggest: call('library:suggest'),
    recentlyPlayed: call('library:recentlyPlayed'),
    romDetail: call('library:romDetail'),
    coreCoverage: call('library:coreCoverage'),
  },
  retroarch: {
    status: call('retroarch:status'),
    setUp: call('retroarch:setUp'),
    installMissingCores: call('retroarch:installMissingCores'),
    onSetupProgress: subscribe('retroarch:setupProgress'),
  },
  game: {
    play: call('game:play'),
    state: call('game:state'),
    download: call('game:download'),
    deleteLocal: call('game:deleteLocal'),
    setCore: call('game:setCore'),
    setFavorite: call('game:setFavorite'),
    onStateChanged: subscribe('game:stateChanged'),
  },
  steam: { status: call('steam:status'), add: call('steam:add') },
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
  updates: {
    state: call('updates:state'),
    check: call('updates:check'),
    install: call('updates:install'),
    onChanged: subscribe('updates:changed'),
  },
  app: {
    online: call('app:online'),
    quit: call('app:quit'),
    toggleFullscreen: call('app:toggleFullscreen'),
    copyLogs: call('app:copyLogs'),
    openLogsFolder: call('app:openLogsFolder'),
    openLink: call('app:openLink'),
    onOnlineChanged: subscribe('app:onlineChanged'),
  },
};

contextBridge.exposeInMainWorld('romm', api);
