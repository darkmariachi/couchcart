import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type {
  IpcChannel,
  IpcErrorInfo,
  IpcRequest,
  IpcResponse,
  IpcResult,
} from '../../shared/ipc';
import type { LauncherApp } from '../launcherApp';
import { log } from '../logging/logger';
import {
  NetworkError,
  NotAuthenticatedError,
  RommApiError,
  SessionExpiredError,
} from '../romm/errors';

const noRequest = z.undefined();
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

function toIpcError(error: unknown): IpcErrorInfo {
  if (error instanceof NotAuthenticatedError) {
    return { code: 'not_authenticated', message: error.message };
  }
  if (error instanceof SessionExpiredError) {
    return { code: 'session_expired', message: error.message };
  }
  if (error instanceof NetworkError) return { code: 'network', message: error.message };
  if (error instanceof RommApiError) {
    return { code: 'api', message: error.message, status: error.status };
  }
  if (error instanceof TypeError && error.message.includes('URL')) {
    return { code: 'invalid_input', message: 'That does not look like a valid server URL.' };
  }
  return { code: 'internal', message: 'Something went wrong. See the log for details.' };
}
