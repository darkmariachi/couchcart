import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadRom,
  isDownloaded,
  type DownloadProgress,
  type RomDownload,
} from '../src/main/downloads/romDownloader';
import { NetworkError } from '../src/main/romm/errors';

const CONTENT = Buffer.from('0123456789'.repeat(1000));
const MD5 = createHash('md5').update(CONTENT).digest('hex');

let dir: string;
let download: RomDownload;
const sleep = vi.fn(async () => {});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'couchcart-dl-'));
  download = {
    urlPath: '/api/roms/21/content/Game%20(U)%20%5B!%5D.z64',
    sizeBytes: CONTENT.length,
    md5: MD5,
    destination: join(dir, 'n64', 'Game (U) [!].z64'),
  };
  sleep.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const partPath = () => `${download.destination}.part`;

/** Serves CONTENT like RomM does, honouring Range requests. */
function rangeServer(content: Buffer = CONTENT) {
  return vi.fn(async (_path: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
    if (start >= content.length && range) return new Response(null, { status: 416 });
    return new Response(content.subarray(start), {
      status: range ? 206 : 200,
      headers: range
        ? { 'content-range': `bytes ${start}-${content.length - 1}/${content.length}` }
        : { 'content-length': `${content.length}` },
    });
  });
}

/** A response whose body fails after `bytes`, like a dropped connection. */
function droppingAfter(bytes: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(CONTENT.subarray(0, bytes));
    },
    pull(controller) {
      controller.error(new Error('socket hang up'));
    },
  });
  return new Response(body, { headers: { 'content-length': `${CONTENT.length}` } });
}

describe('downloadRom', () => {
  it('writes the verified file into place and reports progress', async () => {
    const fetchRaw = rangeServer();
    const progress: DownloadProgress[] = [];

    await downloadRom({ fetchRaw }, download, { onProgress: (p) => progress.push(p) });

    expect(readFileSync(download.destination)).toEqual(CONTENT);
    expect(existsSync(partPath())).toBe(false);
    expect(fetchRaw.mock.calls[0]?.[0]).toBe('/api/roms/21/content/Game%20(U)%20%5B!%5D.z64');
    expect(progress.at(-1)).toEqual({ receivedBytes: CONTENT.length, totalBytes: CONTENT.length });
    expect(await isDownloaded(download)).toBe(true);
  });

  it('resumes from an existing partial file', async () => {
    await downloadRom({ fetchRaw: async () => droppingAfter(4000) }, download, {
      maxAttempts: 1,
    }).catch(() => {});
    expect(readFileSync(partPath())).toHaveLength(4000);
    const fetchRaw = rangeServer();

    await downloadRom({ fetchRaw }, download);

    expect(new Headers(fetchRaw.mock.calls[0]?.[1]?.headers).get('range')).toBe('bytes=4000-');
    expect(readFileSync(download.destination)).toEqual(CONTENT);
  });

  it('retries a dropped connection and resumes within one call', async () => {
    const server = rangeServer();
    const fetchRaw = vi
      .fn<typeof server>()
      .mockImplementationOnce(async () => droppingAfter(2500))
      .mockImplementation(server);

    await downloadRom({ fetchRaw }, download, { sleep });

    expect(readFileSync(download.destination)).toEqual(CONTENT);
    expect(fetchRaw).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget but keeps the partial file for next time', async () => {
    const fetchRaw = vi.fn(async () => droppingAfter(1000));

    await expect(
      downloadRom({ fetchRaw }, download, { sleep, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(NetworkError);

    expect(fetchRaw).toHaveBeenCalledTimes(3);
    expect(existsSync(download.destination)).toBe(false);
    expect(existsSync(partPath())).toBe(true);
  });

  it('starts over when the server ignores the Range header', async () => {
    await downloadRom({ fetchRaw: async () => droppingAfter(4000) }, download, {
      maxAttempts: 1,
    }).catch(() => {});
    const fetchRaw = vi.fn(
      async () => new Response(CONTENT, { headers: { 'content-length': `${CONTENT.length}` } }),
    );

    await downloadRom({ fetchRaw }, download);

    expect(readFileSync(download.destination)).toEqual(CONTENT);
  });

  it('starts over when the partial file is not a prefix of the server file', async () => {
    writeFileSync(join(dir, 'placeholder'), '');
    await downloadRom({ fetchRaw: rangeServer() }, { ...download, md5: null }); // create folder
    rmSync(download.destination);
    writeFileSync(partPath(), Buffer.alloc(CONTENT.length + 50));
    const fetchRaw = rangeServer();

    await downloadRom({ fetchRaw }, download);

    expect(fetchRaw).toHaveBeenCalledTimes(2); // 416, then a fresh request
    expect(readFileSync(download.destination)).toEqual(CONTENT);
  });

  it('rejects a file with the wrong checksum and leaves nothing behind', async () => {
    const corrupted = Buffer.from(CONTENT);
    corrupted[42] = 0xff;

    await expect(downloadRom({ fetchRaw: rangeServer(corrupted) }, download)).rejects.toMatchObject(
      {
        code: 'download_failed',
        message: expect.stringContaining('checksum'),
      },
    );

    expect(existsSync(download.destination)).toBe(false);
    expect(existsSync(partPath())).toBe(false);
  });

  it('rejects a short file', async () => {
    const fetchRaw = async () =>
      new Response(CONTENT.subarray(0, 500), {
        headers: { 'content-length': `${CONTENT.length}` },
      });

    await expect(downloadRom({ fetchRaw }, download)).rejects.toMatchObject({
      code: 'download_failed',
    });
    expect(existsSync(download.destination)).toBe(false);
  });

  it('does not retry an HTTP error', async () => {
    const fetchRaw = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(downloadRom({ fetchRaw }, download, { sleep })).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });

  it('stops without retrying when cancelled', async () => {
    const controller = new AbortController();
    const fetchRaw = vi.fn(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    await expect(
      downloadRom({ fetchRaw }, download, { sleep, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });
});
