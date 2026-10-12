import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { IpcChannel, IpcRequest, IpcResponse, IpcResult } from '../../shared/ipc';
import type { LauncherApp } from '../launcherApp';
import { log } from '../logging/logger';
import { toIpcError } from './errors';

const noRequest = z.undefined();
const romId = z.number().int().positive();
const serverUrl = z.string().trim().min(1).max(2048);

// The renderer is treated as untrusted input: every request is validated before use.
const requestSchemas: { [C in IpcChannel]: z.ZodType<IpcRequest<C>> } = {
  'server:probe': serverUrl,
  'auth:status': noRequest,
  'auth:login': z.object({
    serverUrl,
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(1024),
  }),
  'auth:logout': noRequest,
  'library:platforms': noRequest,
  'library:roms': z.object({
    platformId: z.number().int().positive(),
    search: z.string().max(200).optional(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
  }),
  'library:romAssets': z.number().int().positive(),
  'debug:apiProbe': noRequest,
  'retroarch:status': noRequest,
  'game:play': z.number().int().positive(),
  'game:state': noRequest,
  'saves:sync': romId,
  'saves:lastReport': romId,
  'saves:resolveConflict': z.object({
    romId,
    kind: z.enum(['save', 'state']),
    fileName: z.string().min(1).max(255),
    keep: z.enum(['local', 'server']),
  }),
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
    'auth:status': () => app.status(),
    'auth:login': (request) => app.login(request),
    'auth:logout': () => app.logout(),
    'library:platforms': () => app.listPlatforms(),
    'library:roms': (query) => app.listRoms(query),
    'library:romAssets': (romId) => app.getRomAssets(romId),
    'debug:apiProbe': () => app.runApiProbe(),
    'retroarch:status': () => app.getRetroArchStatus(),
    'game:play': (romId) => app.play(romId),
    'game:state': () => app.getLaunchState(),
    'saves:sync': (id) => app.syncSaves(id),
    'saves:lastReport': (id) => app.getLastSyncReport(id),
    'saves:resolveConflict': (resolution) => app.resolveConflict(resolution),
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
