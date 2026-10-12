import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadJob } from '../src/shared/ipc';
import { cacheSizeBytes, enforceCachePolicy } from '../src/main/downloads/cacheJanitor';
import { DownloadManager } from '../src/main/downloads/downloadManager';
import type { downloadRom } from '../src/main/downloads/romDownloader';
import {
  isPlanDownloaded,
  planRomFiles,
  removeFromCache,
  resolveLaunchTarget,
  type RomFileInfo,
  type RomFilesSource,
} from '../src/main/downloads/romFiles';
import { findMissingBios } from '../src/main/launcher/bios';
import { DataPaths } from '../src/main/paths';

let dir: string;
let paths: DataPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'couchcart-files-'));
  paths = new DataPaths(dir, () => null);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function put(path: string, content: string | Buffer = 'x'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const file = (id: number, name: string, overrides: Partial<RomFileInfo> = {}): RomFileInfo => ({
  id,
  file_name: name,
  full_path: `roms/psx/Final Fantasy VII/${name}`,
  file_size_bytes: 4,
  md5_hash: null,
  category: 'game',
  ...overrides,
});

const multiDisc = (files: RomFileInfo[]): RomFilesSource => ({
  id: 50,
  fs_name: 'Final Fantasy VII',
  fs_size_bytes: files.reduce((total, entry) => total + entry.file_size_bytes, 0),
  md5_hash: null,
  full_path: 'roms/psx/Final Fantasy VII',
  platform_slug: 'psx',
  has_simple_single_file: false,
  files,
});

describe('planRomFiles', () => {
  it('stores a single-file game directly in its platform folder', () => {
    const plan = planRomFiles(
      {
        id: 21,
        fs_name: 'Game (U) [!].z64',
        fs_size_bytes: 100,
        md5_hash: 'abc',
        full_path: 'roms/n64/Game (U) [!].z64',
        platform_slug: 'n64',
        has_simple_single_file: true,
        files: [],
      },
      paths,
    );

    expect(plan).toEqual({
      rootPath: join(dir, 'roms', 'n64', 'Game (U) [!].z64'),
      isFolder: false,
      downloads: [
        {
          urlPath: '/api/roms/21/content/Game%20(U)%20%5B!%5D.z64',
          sizeBytes: 100,
          md5: 'abc',
          destination: join(dir, 'roms', 'n64', 'Game (U) [!].z64'),
        },
      ],
    });
  });

  it('gives a multi-file game its own folder and downloads each file by its id', () => {
    const plan = planRomFiles(
      multiDisc([file(1, 'Disc 1.chd'), file(2, 'Disc 2.chd', { md5_hash: 'ff' })]),
      paths,
    );
    const root = join(dir, 'roms', 'psx', 'Final Fantasy VII');

    expect(plan.isFolder).toBe(true);
    expect(plan.rootPath).toBe(root);
    expect(plan.downloads).toEqual([
      {
        urlPath: '/api/roms/1/files/content/Disc%201.chd',
        sizeBytes: 4,
        md5: null,
        destination: join(root, 'Disc 1.chd'),
      },
      {
        urlPath: '/api/roms/2/files/content/Disc%202.chd',
        sizeBytes: 4,
        md5: 'ff',
        destination: join(root, 'Disc 2.chd'),
      },
    ]);
  });

  it('keeps subfolders and leaves out manuals and soundtracks', () => {
    const plan = planRomFiles(
      multiDisc([
        file(1, 'game.cue'),
        file(2, 'track01.bin', { full_path: 'roms/psx/Final Fantasy VII/tracks/track01.bin' }),
        file(3, 'manual.pdf', { category: 'manual' }),
        file(4, 'ost.flac', { category: 'soundtrack' }),
      ]),
      paths,
    );

    expect(plan.downloads.map((download) => download.destination)).toEqual([
      join(plan.rootPath, 'game.cue'),
      join(plan.rootPath, 'tracks', 'track01.bin'),
    ]);
  });

  it('refuses a file path that would leave the game folder', () => {
    const escaping = multiDisc([
      file(1, 'evil.dll', { full_path: 'roms/psx/Final Fantasy VII/../../evil.dll' }),
    ]);

    expect(() => planRomFiles(escaping, paths)).toThrow(/unsafe/i);
  });

  it('reports a game with nothing playable', () => {
    expect(() =>
      planRomFiles(multiDisc([file(1, 'manual.pdf', { category: 'manual' })]), paths),
    ).toThrow(/no playable files/i);
  });
});

describe('download state on disk', () => {
  it('is complete only when every file has its full size', async () => {
    const plan = planRomFiles(multiDisc([file(1, 'Disc 1.chd'), file(2, 'Disc 2.chd')]), paths);

    expect(await isPlanDownloaded(plan)).toBe(false);
    put(join(plan.rootPath, 'Disc 1.chd'), '1234');
    put(join(plan.rootPath, 'Disc 2.chd'), '12');
    expect(await isPlanDownloaded(plan)).toBe(false);
    put(join(plan.rootPath, 'Disc 2.chd'), '1234');
    expect(await isPlanDownloaded(plan)).toBe(true);

    await removeFromCache(plan);
    expect(existsSync(plan.rootPath)).toBe(false);
  });
});

describe('resolveLaunchTarget', () => {
  const planFor = (names: string[]) => {
    const plan = planRomFiles(multiDisc(names.map((name, index) => file(index + 1, name))), paths);
    names.forEach((name) => put(join(plan.rootPath, name)));
    return plan;
  };

  it('writes a playlist for a multi-disc game, in natural disc order', async () => {
    const plan = planFor(['Game (Disc 10).chd', 'Game (Disc 2).chd', 'Game (Disc 1).chd']);

    const target = await resolveLaunchTarget(plan);

    expect(target).toBe(join(plan.rootPath, 'playlist.m3u'));
    expect(readFileSync(target, 'utf8')).toBe(
      'Game (Disc 1).chd\nGame (Disc 2).chd\nGame (Disc 10).chd\n',
    );
  });

  it('uses a playlist that came with the game', async () => {
    const plan = planFor(['Game.m3u', 'Disc 1.chd', 'Disc 2.chd']);

    expect(await resolveLaunchTarget(plan)).toBe(join(plan.rootPath, 'Game.m3u'));
  });

  it('launches the cue sheet of a single disc, not its bin tracks', async () => {
    const plan = planFor(['Game.cue', 'Game (Track 1).bin', 'Game (Track 2).bin']);

    expect(await resolveLaunchTarget(plan)).toBe(join(plan.rootPath, 'Game.cue'));
  });

  it('launches the only file of a game stored in a folder', async () => {
    const plan = planFor(['Game.z64']);

    expect(await resolveLaunchTarget(plan)).toBe(join(plan.rootPath, 'Game.z64'));
  });

  it('explains when it cannot tell what to start', async () => {
    const plan = planFor(['data.bin', 'more.dat']);

    await expect(resolveLaunchTarget(plan)).rejects.toMatchObject({ code: 'unsupported_rom' });
  });
});

describe('DownloadManager', () => {
  const request = (romId: number, sizes = [10]) => ({
    romId,
    name: `Game ${romId}`,
    files: sizes.map((sizeBytes, index) => ({
      urlPath: `/api/roms/${romId}/content/file${index}`,
      sizeBytes,
      md5: null,
      destination: join(dir, `rom-${romId}-${index}`),
    })),
  });

  /** A download that finishes only when the test says so. */
  function controllableDownloads() {
    const started: string[] = [];
    const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    const download = vi.fn<typeof downloadRom>((_source, file, options) => {
      started.push(file.urlPath);
      return new Promise<void>((resolve, reject) => {
        pending.set(file.urlPath, { resolve, reject });
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const finish = (romId: number, index = 0) =>
      pending.get(`/api/roms/${romId}/content/file${index}`)?.resolve();
    const fail = (romId: number, message: string) =>
      pending.get(`/api/roms/${romId}/content/file0`)?.reject(new Error(message));
    return { download, started, finish, fail };
  }

  function createManager(download: typeof downloadRom) {
    const snapshots: DownloadJob[][] = [];
    const manager = new DownloadManager(
      () => ({ fetchRaw: async () => new Response(null) }),
      (jobs) => snapshots.push(jobs),
      download,
    );
    const statuses = () => Object.fromEntries(manager.list().map((job) => [job.romId, job.status]));
    return { manager, statuses, snapshots };
  }

  it('downloads one game at a time, in the order they were queued', async () => {
    const { download, started, finish } = controllableDownloads();
    const { manager, statuses } = createManager(download);

    const first = manager.enqueue(request(1));
    const second = manager.enqueue(request(2));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(statuses()).toEqual({ 1: 'downloading', 2: 'queued' });

    finish(1);
    await first;
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(statuses()).toEqual({ 1: 'done', 2: 'downloading' });

    finish(2);
    await second;
    expect(statuses()).toEqual({ 1: 'done', 2: 'done' });
  });

  it('lets a game the user wants to play jump the queue', async () => {
    const { download, started, finish } = controllableDownloads();
    const { manager } = createManager(download);
    void manager.enqueue(request(1));
    void manager.enqueue(request(2));
    const urgent = manager.enqueue(request(3), { priority: true });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    finish(1);
    await vi.waitFor(() => expect(started).toHaveLength(2));

    expect(started[1]).toBe('/api/roms/3/content/file0');
    finish(3);
    await urgent;
  });

  it('joins an existing job instead of downloading a game twice', async () => {
    const { download, finish } = controllableDownloads();
    const { manager } = createManager(download);

    const first = manager.enqueue(request(1));
    const again = manager.enqueue(request(1));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    finish(1);

    await Promise.all([first, again]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(1);
  });

  it('downloads every file of a multi-file game and adds up the progress', async () => {
    const { manager } = createManager(async (_source, file, options) => {
      options?.onProgress?.({ receivedBytes: file.sizeBytes, totalBytes: file.sizeBytes });
    });

    await manager.enqueue(request(1, [10, 30]));

    expect(manager.list()[0]).toMatchObject({ status: 'done', receivedBytes: 40, totalBytes: 40 });
  });

  it('cancels the active download and moves on to the next', async () => {
    const { download, started, finish } = controllableDownloads();
    const { manager, statuses } = createManager(download);
    const first = manager.enqueue(request(1));
    const second = manager.enqueue(request(2));
    await vi.waitFor(() => expect(started).toHaveLength(1));

    manager.cancel(1);

    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(statuses()).toEqual({ 1: 'cancelled', 2: 'downloading' });
    finish(2);
    await second;
  });

  it('cancels a queued download without starting it', async () => {
    const { download, started, finish } = controllableDownloads();
    const { manager } = createManager(download);
    const first = manager.enqueue(request(1));
    const second = manager.enqueue(request(2));
    await vi.waitFor(() => expect(started).toHaveLength(1));

    manager.cancel(2);
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    finish(1);
    await first;

    expect(started).toEqual(['/api/roms/1/content/file0']);
  });

  it('records a failure, keeps going, and can retry the failed game', async () => {
    const { download, started, finish, fail } = controllableDownloads();
    const { manager, statuses } = createManager(download);
    const first = manager.enqueue(request(1));
    const second = manager.enqueue(request(2));
    await vi.waitFor(() => expect(started).toHaveLength(1));

    fail(1, 'disk full');
    await expect(first).rejects.toThrow('disk full');
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(manager.list()[0]).toMatchObject({ status: 'failed', error: 'disk full' });
    finish(2);
    await second;

    const retry = manager.enqueue(request(1));
    await vi.waitFor(() => expect(started).toHaveLength(3));
    finish(1);
    await retry;
    expect(statuses()).toEqual({ 2: 'done', 1: 'done' });
  });

  it('clears finished jobs but keeps what is still in progress', async () => {
    const { download, started, finish } = controllableDownloads();
    const { manager, statuses } = createManager(download);
    const first = manager.enqueue(request(1));
    void manager.enqueue(request(2));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    finish(1);
    await first;
    await vi.waitFor(() => expect(started).toHaveLength(2));

    manager.clearFinished();

    expect(statuses()).toEqual({ 2: 'downloading' });
  });
});

describe('cache policy', () => {
  const GB = 1024 ** 3;
  // Sizes are faked through the policy limit rather than by writing gigabytes.
  const game = (platform: string, name: string, bytes: number, daysAgo: number) => {
    const path = join(dir, 'cache', platform, name);
    put(path, Buffer.alloc(bytes));
    const when = new Date(Date.UTC(2026, 0, 30) - daysAgo * 86_400_000);
    utimesSync(path, when, when);
    return path;
  };
  const cache = () => join(dir, 'cache');
  const limit = (bytes: number) => ({ keep: 'limit' as const, limitGb: bytes / GB });

  it('never removes anything when games are always kept', async () => {
    const old = game('n64', 'old.z64', 500, 300);

    expect(await enforceCachePolicy(cache(), { keep: 'always', limitGb: 1 }, null)).toEqual([]);
    expect(existsSync(old)).toBe(true);
  });

  it('removes only the game just played when games are never kept', async () => {
    const played = game('n64', 'played.z64', 100, 0);
    const other = game('n64', 'other.z64', 100, 10);

    expect(await enforceCachePolicy(cache(), { keep: 'never', limitGb: 1 }, played)).toEqual([
      played,
    ]);
    expect(existsSync(played)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it('evicts the least recently used games until the cache fits', async () => {
    const oldest = game('n64', 'oldest.z64', 400, 30);
    const older = game('snes', 'older.sfc', 400, 20);
    const recent = game('n64', 'recent.z64', 400, 1);

    const removed = await enforceCachePolicy(cache(), limit(500), null);

    expect(removed).toEqual([oldest, older]);
    expect(existsSync(recent)).toBe(true);
    expect(await cacheSizeBytes(cache())).toBe(400);
  });

  it('does not evict the game that was just played, even if it is the oldest file', async () => {
    const justPlayed = game('n64', 'played.z64', 400, 30);
    const other = game('n64', 'other.z64', 400, 1);

    const removed = await enforceCachePolicy(cache(), limit(500), justPlayed);

    expect(removed).toEqual([other]);
    expect(existsSync(justPlayed)).toBe(true);
  });

  it('treats a multi-file game as one unit and ignores unfinished downloads', async () => {
    put(join(cache(), 'psx', 'Big Game', 'Disc 1.chd'), Buffer.alloc(300));
    put(join(cache(), 'psx', 'Big Game', 'Disc 2.chd'), Buffer.alloc(300));
    put(join(cache(), 'psx', 'Other.chd.part'), Buffer.alloc(999));

    expect(await cacheSizeBytes(cache())).toBe(600);
    expect(await enforceCachePolicy(cache(), limit(100), null)).toEqual([
      join(cache(), 'psx', 'Big Game'),
    ]);
    expect(existsSync(join(cache(), 'psx', 'Other.chd.part'))).toBe(true);
  });

  it('does nothing while the cache is within its limit, or does not exist', async () => {
    game('n64', 'a.z64', 100, 5);

    expect(await enforceCachePolicy(cache(), limit(1000), null)).toEqual([]);
    expect(await enforceCachePolicy(join(dir, 'missing'), limit(1), null)).toEqual([]);
  });
});

describe('findMissingBios', () => {
  const requirements = {
    psx: [{ name: 'PlayStation BIOS', anyOf: ['scph5501.bin', 'scph1001.bin'] }],
    dc: [{ name: 'Dreamcast BIOS', anyOf: ['dc/dc_boot.bin'] }],
  };
  const system = () => join(dir, 'system');

  it('reports a requirement when none of its files is present', async () => {
    mkdirSync(system());

    expect(await findMissingBios(['psx'], system(), requirements)).toEqual([
      'PlayStation BIOS (one of: scph5501.bin, scph1001.bin)',
    ]);
  });

  it('is satisfied by any one of the files, whatever its capitalisation', async () => {
    put(join(system(), 'SCPH1001.BIN'));

    expect(await findMissingBios(['psx'], system(), requirements)).toEqual([]);
  });

  it('looks in subfolders when the requirement names one', async () => {
    expect(await findMissingBios(['dc'], system(), requirements)).toHaveLength(1);
    put(join(system(), 'dc', 'dc_boot.bin'));
    expect(await findMissingBios(['dc'], system(), requirements)).toEqual([]);
  });

  it('knows no requirements for most platforms, and falls back to the folder slug', async () => {
    expect(await findMissingBios(['n64'], system(), requirements)).toEqual([]);
    expect(await findMissingBios(['playstation', 'psx'], system(), requirements)).toHaveLength(1);
  });
});
