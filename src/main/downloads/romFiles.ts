import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { LauncherError } from '../errors';
import { safeSegment, type DataPaths } from '../paths';
import type { RomDownload } from './romDownloader';

/** One file belonging to a multi-file game, as RomM describes it. */
export interface RomFileInfo {
  id: number;
  file_name: string;
  full_path: string;
  file_size_bytes: number;
  md5_hash: string | null;
  category: string | null;
}

/** The parts of a RomM ROM record needed to store and start a game. */
export interface RomFilesSource {
  id: number;
  fs_name: string;
  fs_size_bytes: number;
  md5_hash: string | null;
  full_path: string;
  platform_slug: string;
  has_simple_single_file: boolean;
  files: RomFileInfo[];
}

export interface RomFilePlan {
  /** The file or folder that holds the game in the cache. */
  rootPath: string;
  isFolder: boolean;
  downloads: RomDownload[];
}

// Extras RomM can attach to a game that RetroArch has no use for.
const SKIPPED_CATEGORIES = new Set(['manual', 'walkthrough', 'soundtrack', 'screenshot', 'cheat']);

/**
 * Decides which files a game needs and where they go.
 * A single-file game is `<cache>/<platform>/<file>`; anything else becomes a folder named
 * after the game, with its files laid out as they are on the server.
 */
export function planRomFiles(rom: RomFilesSource, paths: DataPaths): RomFilePlan {
  const rootPath = paths.romFile(rom.platform_slug, rom.fs_name);

  if (rom.has_simple_single_file) {
    return {
      rootPath,
      isFolder: false,
      downloads: [
        {
          urlPath: `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`,
          sizeBytes: rom.fs_size_bytes,
          md5: rom.md5_hash,
          destination: rootPath,
        },
      ],
    };
  }

  const downloads = rom.files
    .filter((file) => !SKIPPED_CATEGORIES.has(file.category ?? ''))
    .map((file) => ({
      urlPath: `/api/roms/${file.id}/files/content/${encodeURIComponent(file.file_name)}`,
      sizeBytes: file.file_size_bytes,
      md5: file.md5_hash,
      destination: join(rootPath, ...relativeSegments(rom, file)),
    }));
  if (downloads.length === 0) {
    throw new LauncherError('unsupported_rom', 'RomM lists no playable files for this game.');
  }
  return { rootPath, isFolder: true, downloads };
}

/** Where a file sits inside its game's folder. Every segment is checked for safety. */
function relativeSegments(rom: RomFilesSource, file: RomFileInfo): string[] {
  const prefix = `${rom.full_path}/`;
  const relative = file.full_path.startsWith(prefix)
    ? file.full_path.slice(prefix.length)
    : file.file_name;
  return relative.split('/').map(safeSegment);
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function isPlanDownloaded(plan: RomFilePlan): Promise<boolean> {
  for (const download of plan.downloads) {
    if ((await sizeOf(download.destination)) !== download.sizeBytes) return false;
  }
  return true;
}

export async function removeFromCache(plan: RomFilePlan): Promise<void> {
  await rm(plan.rootPath, { recursive: true, force: true });
  await rm(`${plan.rootPath}.part`, { force: true });
}

/** Marks the game as just used, which is what cache eviction orders by. */
export async function touchPlan(plan: RomFilePlan): Promise<void> {
  const now = new Date();
  await utimes(plan.rootPath, now, now).catch(() => undefined);
}

// Formats that describe a whole disc by themselves. A .bin only counts through its .cue.
const DISC_EXTENSIONS = new Set(['.cue', '.chd', '.iso', '.gdi', '.cdi', '.pbp', '.ccd', '.rvz']);

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

async function listFilesRecursively(root: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listFilesRecursively(root, relative)));
    else found.push(relative);
  }
  return found;
}

/**
 * The file to hand to RetroArch.
 *
 * For a multi-file game that is, in order of preference: a playlist the game already has,
 * a playlist generated for its discs (so RetroArch can swap discs), its single disc image,
 * or its only file.
 */
export async function resolveLaunchTarget(plan: RomFilePlan): Promise<string> {
  if (!plan.isFolder) return plan.rootPath;

  const files = (await listFilesRecursively(plan.rootPath)).sort(naturalOrder.compare);
  const withExtension = (extension: string) =>
    files.filter((file) => extname(file).toLowerCase() === extension);

  const [playlist] = withExtension('.m3u');
  if (playlist) return join(plan.rootPath, playlist);

  const discs = files.filter((file) => DISC_EXTENSIONS.has(extname(file).toLowerCase()));
  if (discs.length > 1) return writePlaylist(plan.rootPath, discs);

  const target = discs[0] ?? (files.length === 1 ? files[0] : undefined);
  if (!target) {
    throw new LauncherError(
      'unsupported_rom',
      'This game has several files and none of them is a disc image or playlist the launcher knows how to start.',
    );
  }
  return join(plan.rootPath, target);
}

/** Writes a playlist into the game folder, listing the discs relative to the playlist. */
async function writePlaylist(rootPath: string, discs: string[]): Promise<string> {
  await mkdir(rootPath, { recursive: true });
  const playlistPath = join(rootPath, 'playlist.m3u');
  await writeFile(playlistPath, `${discs.join('\n')}\n`);
  return playlistPath;
}
