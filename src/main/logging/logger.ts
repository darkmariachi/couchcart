import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from './redact';

type Level = 'info' | 'warn' | 'error';

const MAX_FILE_BYTES = 1024 * 1024;
const KEPT_FILES = 5;

let logFile: string | null = null;

/**
 * Starts writing log lines to a file as well as the console. Until this is called (for
 * example in tests) the logger is console-only.
 */
export function enableFileLogging(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  logFile = filePath;
}

export function getLogFile(): string | null {
  return logFile;
}

/** The newest part of the log, for the "copy logs" button. */
export function readRecentLog(maxLines = 400): string {
  if (!logFile) return '';
  try {
    return readFileSync(logFile, 'utf8').split('\n').slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

/** Keeps the log bounded: launcher.log, launcher.1.log ... launcher.4.log, 1 MB each. */
function rotateIfNeeded(filePath: string): void {
  try {
    if (statSync(filePath).size < MAX_FILE_BYTES) return;
  } catch {
    return; // no log file yet
  }
  const numbered = (index: number) => filePath.replace(/\.log$/, `.${index}.log`);
  rmSync(numbered(KEPT_FILES - 1), { force: true });
  for (let index = KEPT_FILES - 2; index >= 1; index--) {
    try {
      renameSync(numbered(index), numbered(index + 1));
    } catch {
      // That generation does not exist yet.
    }
  }
  renameSync(filePath, numbered(1));
}

function write(level: Level, message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` ${describe(detail)}`;
  // Everything passes through redact(), so neither sink can receive a credential.
  const line = redact(`${new Date().toISOString()} [${level}] ${message}${suffix}`);
  console[level](line);

  if (!logFile) return;
  try {
    rotateIfNeeded(logFile);
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // Logging must never be the reason something else fails.
  }
}

function describe(detail: unknown): string {
  if (detail instanceof Error) {
    const cause = detail.cause instanceof Error ? ` (cause: ${detail.cause.message})` : '';
    return `${detail.name}: ${detail.message}${cause}`;
  }
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

export const log = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};
