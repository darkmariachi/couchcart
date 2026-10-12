import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheKeepMode } from '../../shared/ipc';

export interface CachePolicy {
  keep: CacheKeepMode;
  limitGb: number;
}

/** One game in the cache: a file, or a folder for multi-file games. */
interface CachedGame {
  path: string;
  sizeBytes: number;
  lastUsedMs: number;
}

async function sizeOfTree(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(path)) total += await sizeOfTree(join(path, name));
  return total;
}

/** Every game in the cache. Layout: `<cache>/<platform>/<game file or folder>`. */
async function listCachedGames(cacheDir: string): Promise<CachedGame[]> {
  const games: CachedGame[] = [];
  let platforms: string[];
  try {
    platforms = await readdir(cacheDir);
  } catch {
    return games;
  }
  for (const platform of platforms) {
    const platformDir = join(cacheDir, platform);
    try {
      for (const name of await readdir(platformDir)) {
        if (name.endsWith('.part')) continue; // an unfinished download, not a game
        const path = join(platformDir, name);
        games.push({
          path,
          sizeBytes: await sizeOfTree(path),
          lastUsedMs: (await stat(path)).mtimeMs,
        });
      }
    } catch {
      // Not a platform folder.
    }
  }
  return games;
}

export async function cacheSizeBytes(cacheDir: string): Promise<number> {
  return (await listCachedGames(cacheDir)).reduce((total, game) => total + game.sizeBytes, 0);
}

/**
 * Applies the "keep games" setting after a session. Returns the paths that were removed.
 *
 * - always: nothing is removed.
 * - never: the game that was just played is removed (cloud-style play).
 * - limit: the games unused for longest are removed until the cache fits, never the one
 *   that was just played.
 *
 * Only ROM files are touched. Saves and states live elsewhere and are never removed here.
 */
export async function enforceCachePolicy(
  cacheDir: string,
  policy: CachePolicy,
  justPlayedPath: string | null,
): Promise<string[]> {
  if (policy.keep === 'always') return [];

  if (policy.keep === 'never') {
    if (!justPlayedPath) return [];
    await rm(justPlayedPath, { recursive: true, force: true });
    return [justPlayedPath];
  }

  const games = await listCachedGames(cacheDir);
  const limitBytes = policy.limitGb * 1024 ** 3;
  let total = games.reduce((sum, game) => sum + game.sizeBytes, 0);

  const removed: string[] = [];
  for (const game of games.sort((a, b) => a.lastUsedMs - b.lastUsedMs)) {
    if (total <= limitBytes) break;
    if (game.path === justPlayedPath) continue;
    await rm(game.path, { recursive: true, force: true });
    total -= game.sizeBytes;
    removed.push(game.path);
  }
  return removed;
}
