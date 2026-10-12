import type { IpcErrorCode, IpcErrorInfo, IpcResult } from '../shared/ipc';

export class LauncherError extends Error {
  readonly code: IpcErrorCode;
  readonly status: number | undefined;

  constructor(info: IpcErrorInfo) {
    super(info.message);
    this.name = 'LauncherError';
    this.code = info.code;
    this.status = info.status;
  }
}

/** Turns a bridge result back into a value-or-throw, which is what React Query expects. */
export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw new LauncherError(result.error);
  return result.value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

export function isAuthError(error: unknown): boolean {
  return (
    error instanceof LauncherError &&
    (error.code === 'session_expired' || error.code === 'not_authenticated')
  );
}
