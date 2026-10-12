import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { ImportPreview, SyncKind } from '../../shared/ipc';
import type { DataPaths } from '../paths';

export interface ImportableRom {
  fs_name: string;
  name: string | null;
  platform_slug: string;
}

export interface ImportCandidate {
  kind: SyncKind;
  sourcePath: string;
  /** Destination inside the launcher's own save or state folder. */
  targetPath: string;
  gameName: string;
  modifiedMs: number;
}

/** Where a RetroArch install keeps the saves and states it wrote on its own. */
export async function readRetroArchSaveDirs(
  retroarchRoot: string,
): Promise<{ saves: string; states: string }> {
  let config = '';
  try {
    config = await readFile(join(retroarchRoot, 'retroarch.cfg'), 'utf8');
  } catch {
    // No config yet: RetroArch then uses its default folders.
  }
  const setting = (key: string) => new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, 'm').exec(config)?.[1];
  return {
    saves: resolveConfigDir(setting('savefile_directory'), retroarchRoot, 'saves'),
    states: resolveConfigDir(setting('savestate_directory'), retroarchRoot, 'states'),
  };
}

/** RetroArch writes `:` for "next to the executable", `~` for home and `default` for unset. */
export function resolveConfigDir(
  value: string | undefined,
  retroarchRoot: string,
  fallback: string,
): string {
  if (!value || value === 'default') return join(retroarchRoot, fallback);
  if (value.startsWith(':')) return join(retroarchRoot, value.slice(1));
  if (value.startsWith('~')) return join(homedir(), value.slice(1));
  return isAbsolute(value) ? value : join(retroarchRoot, value);
}

const STATE_NAME = /^(.+)\.state(?:\d+|\.auto)?$/;
const SAVE_NAME = /^(.+)\.[A-Za-z0-9]+$/;
const NOT_SAVE_DATA = /\.(png|tmp|bak|part|txt|cfg)$/i;

/**
 * Finds saves RetroArch wrote before the launcher existed and that belong to a game in the
 * RomM library. Matching is by file name, which is how RetroArch itself ties a save to a
 * game. Nothing that already exists in the launcher's folders is ever a candidate.
 */
export async function findImportCandidates(
  sourceDirs: { saves: string; states: string },
  roms: ImportableRom[],
  paths: DataPaths,
): Promise<ImportCandidate[]> {
  const romsByBaseName = new Map<string, ImportableRom[]>();
  for (const rom of roms) {
    const base = rom.fs_name.replace(/\.[^.]+$/, '');
    romsByBaseName.set(base, [...(romsByBaseName.get(base) ?? []), rom]);
  }

  const byTarget = new Map<string, ImportCandidate>();
  for (const kind of ['save', 'state'] as const) {
    const pattern = kind === 'save' ? SAVE_NAME : STATE_NAME;
    for (const file of await listFiles(kind === 'save' ? sourceDirs.saves : sourceDirs.states)) {
      if (NOT_SAVE_DATA.test(file.name)) continue;
      const baseName = pattern.exec(file.name)?.[1];
      const matches = baseName ? (romsByBaseName.get(baseName) ?? []) : [];
      // The same name on two platforms cannot be attributed safely, so it is left alone.
      const platforms = new Set(matches.map((rom) => rom.platform_slug));
      const [rom] = matches;
      if (!rom || platforms.size !== 1) continue;

      const targetDir =
        kind === 'save' ? paths.savesDir(rom.platform_slug) : paths.statesDir(rom.platform_slug);
      const targetPath = join(targetDir, file.name);
      if (await exists(targetPath)) continue;

      // RetroArch may hold the same save in its root and in a per-core folder; the most
      // recently written one is the one the player last used.
      const previous = byTarget.get(targetPath);
      if (previous && previous.modifiedMs >= file.modifiedMs) continue;
      byTarget.set(targetPath, {
        kind,
        sourcePath: file.path,
        targetPath,
        gameName: rom.name ?? baseName ?? file.name,
        modifiedMs: file.modifiedMs,
      });
    }
  }
  return [...byTarget.values()];
}

export function toPreview(candidates: ImportCandidate[]): ImportPreview {
  return {
    saves: candidates.filter((candidate) => candidate.kind === 'save').length,
    states: candidates.filter((candidate) => candidate.kind === 'state').length,
    games: [...new Set(candidates.map((candidate) => candidate.gameName))].sort(),
  };
}

/**
 * Copies the candidates into the launcher's folders. The originals stay where they are,
 * and an existing destination is never overwritten. Returns how many files were copied.
 */
export async function importCandidates(candidates: ImportCandidate[]): Promise<number> {
  let imported = 0;
  for (const candidate of candidates) {
    await mkdir(dirname(candidate.targetPath), { recursive: true });
    try {
      await copyFile(candidate.sourcePath, candidate.targetPath, constants.COPYFILE_EXCL);
      imported++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return imported;
}

/** Files directly in `dir` and one level down (RetroArch's optional per-core folders). */
async function listFiles(
  dir: string,
): Promise<{ name: string; path: string; modifiedMs: number }[]> {
  const files: { name: string; path: string; modifiedMs: number }[] = [];
  const visit = async (folder: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < 1) await visit(path, depth + 1);
      } else if (entry.isFile()) {
        files.push({ name: entry.name, path, modifiedMs: (await stat(path)).mtimeMs });
      }
    }
  };
  await visit(dir, 0);
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
