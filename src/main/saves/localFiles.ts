import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { SyncKind } from '../../shared/ipc';

// RetroArch names save states "<game>.state", "<game>.state1" ... and "<game>.state.auto".
const STATE_SUFFIX = /^state(\d+|\.auto)?$/;
// Battery saves use one plain extension: .srm, .sav, .eep, .mpk, .rtc ...
const SAVE_SUFFIX = /^[A-Za-z0-9]+$/;
// Leftovers that share the folder but are not save data.
const IGNORED_SAVE_SUFFIXES = new Set(['tmp', 'part', 'bak', 'png']);

/** Whether `fileName` is a save (or state) RetroArch writes for the game named `baseName`. */
export function belongsToGame(fileName: string, baseName: string, kind: SyncKind): boolean {
  if (!fileName.startsWith(`${baseName}.`)) return false;
  const suffix = fileName.slice(baseName.length + 1);
  if (kind === 'state') return STATE_SUFFIX.test(suffix);
  return SAVE_SUFFIX.test(suffix) && !IGNORED_SAVE_SUFFIXES.has(suffix.toLowerCase());
}

export async function listLocalFiles(
  dir: string,
  baseName: string,
  kind: SyncKind,
): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => belongsToGame(name, baseName, kind));
  } catch {
    return [];
  }
}

export function md5(content: Buffer): string {
  return createHash('md5').update(content).digest('hex');
}

export async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
