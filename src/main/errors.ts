import type { IpcErrorCode } from '../shared/ipc';

/** An expected failure with a message that is safe and useful to show to the user. */
export class LauncherError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LauncherError';
  }
}
