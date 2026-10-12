import type { IpcErrorInfo } from '../../shared/ipc';
import { LauncherError } from '../errors';
import {
  NetworkError,
  NotAuthenticatedError,
  RommApiError,
  SessionExpiredError,
} from '../romm/errors';

/** Maps any thrown value to something safe to show in the UI. */
export function toIpcError(error: unknown): IpcErrorInfo {
  if (error instanceof LauncherError) return { code: error.code, message: error.message };
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
