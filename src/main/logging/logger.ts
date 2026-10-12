import { redact } from './redact';

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` ${describe(detail)}`;
  console[level](redact(`${new Date().toISOString()} [${level}] ${message}${suffix}`));
}

function describe(detail: unknown): string {
  if (detail instanceof Error) {
    const cause = detail.cause instanceof Error ? ` (cause: ${detail.cause.message})` : '';
    return `${detail.name}: ${detail.message}${cause}`;
  }
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

// Console only for now; rotating files in the app data folder arrive with Milestone 6.
// Everything goes through redact() so the file sink inherits the same guarantee.
export const log = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};
