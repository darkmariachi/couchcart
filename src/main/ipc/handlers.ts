import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { IpcChannel, IpcRequest, IpcResponse, IpcResult } from '../../shared/ipc';
import type { LauncherApp } from '../launcherApp';
import { log } from '../logging/logger';
import { toIpcError } from './errors';

const noRequest = z.undefined();
const romId = z.number().int().positive();
const serverUrl = z.string().trim().min(1).max(2048);
const path = z.string().min(1).max(4096);
const coreName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/)
  .max(100);
const gamepadCombo = z.enum(['keep', 'none', 'hold_start', 'hold_select', 'start_select', 'l3_r3']);

// The renderer is treated as untrusted input: every request is validated before use.
const requestSchemas: { [C in IpcChannel]: z.ZodType<IpcRequest<C>> } = {
  'server:probe': serverUrl,
  'server:discover': noRequest,
  'auth:status': noRequest,
  'auth:login': z.object({
    serverUrl,
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(1024),
  }),
  'auth:logout': noRequest,
  'account:overview': noRequest,

  'library:platforms': noRequest,
  'library:gridRoms': z.discriminatedUnion('type', [
    z.object({ type: z.literal('platform'), platformId: romId }),
    z.object({
      type: z.literal('collection'),
      kind: z.enum(['regular', 'smart', 'virtual']),
      id: z.string().min(1).max(200),
    }),
    z.object({ type: z.literal('search'), term: z.string().trim().min(1).max(200) }),
  ]),
  'library:recentlyAdded': noRequest,
  'library:collections': noRequest,
  'library:suggest': z.string().trim().min(1).max(200),
  'library:recentlyPlayed': noRequest,
  'library:romDetail': romId,
  'library:coreCoverage': noRequest,

  'retroarch:status': noRequest,
  'game:play': z.object({
    romId,
    ignoreConflicts: z.boolean().optional(),
    ignoreMissingBios: z.boolean().optional(),
  }),
  'game:state': noRequest,
  'game:download': romId,
  'game:deleteLocal': romId,
  'game:setCore': z.object({ romId, core: coreName.nullable() }),
  'game:setFavorite': z.object({ romId, favorite: z.boolean() }),

  'downloads:list': noRequest,
  'downloads:cancel': romId,
  'downloads:clearFinished': noRequest,

  'saves:sync': romId,
  'saves:lastReport': romId,
  'saves:resolveConflict': z.object({
    romId,
    kind: z.enum(['save', 'state']),
    fileName: z.string().min(1).max(255),
    keep: z.enum(['local', 'server']),
  }),
  'saves:syncAll': noRequest,

  'controllers:list': noRequest,
  'controllers:detect': noRequest,
  'controllers:setPlayerOne': z.string().min(1).max(300),

  'settings:get': noRequest,
  'settings:update': z.object({
    deviceName: z.string().trim().min(1).max(100).optional(),
    saveBackupCount: z.number().int().min(1).max(1000).optional(),
    launcherFullscreen: z.boolean().optional(),
    retroarchFullscreen: z.boolean().optional(),
    hideTouchOverlay: z.boolean().optional(),
    retroarchExtraArgs: z.string().max(1000).optional(),
    retroarchPath: path.nullable().optional(),
    coresDir: path.nullable().optional(),
    cacheKeep: z.enum(['always', 'limit', 'never']).optional(),
    cacheLimitGb: z.number().min(1).max(100_000).optional(),
    menuCombo: gamepadCombo.optional(),
    quitCombo: gamepadCombo.optional(),
    platformCore: z
      .object({ slug: z.string().min(1).max(100), core: coreName.nullable() })
      .optional(),
  }),
  'settings:choosePath': z.enum(['cache', 'retroarch', 'cores']),

  'setup:status': noRequest,
  'setup:chooseCacheDir': noRequest,
  'setup:importPreview': noRequest,
  'setup:importSaves': noRequest,
  'setup:complete': noRequest,

  'app:online': noRequest,
  'app:quit': noRequest,
  'app:toggleFullscreen': noRequest,
  'app:copyLogs': noRequest,
  'app:openLogsFolder': noRequest,
  'app:openLink': z.enum(['retroarch-steam', 'retroarch-website']),
};

type Handlers = {
  [C in IpcChannel]: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>;
};

export function registerIpcHandlers(
  app: LauncherApp,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handlers: Handlers = {
    'server:probe': (url) => app.probeServer(url),
    'server:discover': () => app.discoverServers(),
    'auth:status': () => app.status(),
    'auth:login': (request) => app.login(request),
    'auth:logout': () => app.logout(),
    'account:overview': () => app.getAccountOverview(),

    'library:platforms': () => app.listPlatforms(),
    'library:gridRoms': (source) => app.listGridRoms(source),
    'library:recentlyAdded': () => app.listRecentlyAdded(),
    'library:collections': () => app.listCollections(),
    'library:suggest': (term) => app.suggestGames(term),
    'library:recentlyPlayed': () => app.listRecentlyPlayed(),
    'library:romDetail': (id) => app.getRomDetail(id),
    'library:coreCoverage': () => app.getCoreCoverage(),

    'retroarch:status': () => app.getRetroArchStatus(),
    'game:play': (request) => app.play(request),
    'game:state': () => app.getLaunchState(),
    'game:download': (id) => app.downloadRom(id),
    'game:deleteLocal': (id) => app.deleteLocalRom(id),
    'game:setCore': ({ romId: id, core }) => app.setGameCore(id, core),
    'game:setFavorite': ({ romId: id, favorite }) => app.setFavorite(id, favorite),

    'downloads:list': () => app.listDownloads(),
    'downloads:cancel': (id) => app.cancelDownload(id),
    'downloads:clearFinished': () => app.clearFinishedDownloads(),

    'saves:sync': (id) => app.syncSaves(id),
    'saves:lastReport': (id) => app.getLastSyncReport(id),
    'saves:resolveConflict': (resolution) => app.resolveConflict(resolution),
    'saves:syncAll': () => app.syncAllSaves(),

    'controllers:list': () => app.listControllers(),
    'controllers:detect': () => app.detectControllers(),
    'controllers:setPlayerOne': (signature) => app.setPlayerOne(signature),

    'settings:get': () => app.getSettingsView(),
    'settings:update': (patch) => app.updateSettings(patch),
    'settings:choosePath': (setting) => app.chooseSettingPath(setting),

    'setup:status': () => app.getSetupStatus(),
    'setup:chooseCacheDir': () => app.chooseCacheDir(),
    'setup:importPreview': () => app.getImportPreview(),
    'setup:importSaves': () => app.importSaves(),
    'setup:complete': () => app.completeSetup(),

    'app:online': () => app.isOnline(),
    'app:quit': () => app.quit(),
    'app:toggleFullscreen': () => app.toggleFullscreen(),
    'app:copyLogs': () => app.copyLogs(),
    'app:openLogsFolder': () => app.openLogsFolder(),
    'app:openLink': (link) => app.openLink(link),
  };

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    register(channel, handlers[channel], isTrustedSender);
  }
}

function register<C extends IpcChannel>(
  channel: C,
  handler: Handlers[C],
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(channel, async (event, rawRequest): Promise<IpcResult<IpcResponse<C>>> => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: { code: 'internal', message: 'Untrusted IPC sender.' } };
    }
    const parsed = requestSchemas[channel].safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, error: { code: 'invalid_input', message: 'Invalid request.' } };
    }
    try {
      return { ok: true, value: await handler(parsed.data) };
    } catch (error) {
      log.warn(`IPC ${channel} failed`, error);
      return { ok: false, error: toIpcError(error) };
    }
  });
}
