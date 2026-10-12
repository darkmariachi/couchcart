import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { LauncherError } from '../errors';
import { NetworkError, RommApiError } from '../romm/errors';

export interface RomDownload {
  /** Server path of the content, e.g. `/api/roms/12/content/Game.z64`. */
  urlPath: string;
  /** Size RomM reports for the file; used when the response does not declare one. */
  sizeBytes: number;
  /**
   * MD5 RomM computed for the file, if any. For an archive it covers the unpacked contents,
   * not the file itself, so it is only checked for files that are not archives.
   */
  md5: string | null;
  destination: string;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface RomContentSource {
  fetchRaw(pathAndQuery: string, init?: RequestInit): Promise<Response>;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const PROGRESS_INTERVAL_MS = 200;

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function isDownloaded(download: RomDownload): Promise<boolean> {
  return (await sizeOf(download.destination)) === download.sizeBytes;
}

/**
 * Downloads a single-file ROM into the cache. The data goes to a `.part` file that is
 * verified and only then renamed into place, so the cache never holds a partial ROM under
 * its real name. An interrupted download resumes from the `.part` file.
 */
export async function downloadRom(
  source: RomContentSource,
  download: RomDownload,
  options: DownloadOptions = {},
): Promise<void> {
  const { maxAttempts = 4, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } =
    options;
  const partPath = `${download.destination}.part`;
  await mkdir(dirname(download.destination), { recursive: true });

  for (let attempt = 1; ; attempt++) {
    try {
      const totalBytes = await fetchIntoPartFile(source, download, partPath, options);
      await verify(partPath, totalBytes, download);
      await rename(partPath, download.destination);
      return;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A dropped connection keeps the .part file and resumes; anything else is final.
      if (!(error instanceof NetworkError) || attempt >= maxAttempts) throw error;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

/** Returns the full size of the file as declared by the server. */
async function fetchIntoPartFile(
  source: RomContentSource,
  download: RomDownload,
  partPath: string,
  { onProgress, signal }: DownloadOptions,
): Promise<number> {
  const url = download.urlPath;
  let existingBytes = (await sizeOf(partPath)) ?? 0;

  let response = await source.fetchRaw(url, {
    headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : {},
    signal: signal ?? null,
  });

  if (response.status === 416) {
    // The .part file is as long as (or longer than) the file on the server, so it cannot
    // be a prefix of it. Start over.
    await rm(partPath, { force: true });
    existingBytes = 0;
    response = await source.fetchRaw(url, { signal: signal ?? null });
  }
  if (!response.ok || !response.body) {
    throw new RommApiError(response.status, `Download failed (HTTP ${response.status}).`);
  }

  // 200 means the server ignored the Range header and is sending the whole file.
  const resuming = response.status === 206;
  if (!resuming) existingBytes = 0;
  const totalBytes = declaredTotal(response, existingBytes) ?? download.sizeBytes;

  const file = createWriteStream(partPath, { flags: resuming ? 'a' : 'w' });
  let receivedBytes = existingBytes;
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      if (!file.write(chunk))
        await new Promise<void>((resolve) => file.once('drain', () => resolve()));
      receivedBytes += chunk.byteLength;
      if (Date.now() - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = Date.now();
        onProgress?.({ receivedBytes, totalBytes });
      }
    }
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new NetworkError('The connection dropped during the download.', { cause });
  } finally {
    await new Promise<void>((resolve) => file.end(resolve));
  }

  onProgress?.({ receivedBytes, totalBytes });
  return totalBytes;
}

function declaredTotal(response: Response, existingBytes: number): number | null {
  const fromRange = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1];
  if (fromRange) return Number(fromRange);
  // With a content encoding, Content-Length counts compressed bytes, not file bytes.
  if (response.headers.has('content-encoding')) return null;
  const length = response.headers.get('content-length');
  return length ? existingBytes + Number(length) : null;
}

async function verify(
  partPath: string,
  expectedBytes: number,
  download: RomDownload,
): Promise<void> {
  const actualBytes = await sizeOf(partPath);
  let problem: string | null = null;

  if (actualBytes !== expectedBytes) {
    problem = `expected ${expectedBytes} bytes but received ${actualBytes ?? 0}`;
  } else if (
    download.md5 &&
    !(await isArchive(partPath, download.destination)) &&
    (await md5Of(partPath)) !== download.md5.toLowerCase()
  ) {
    problem = 'the checksum does not match the one RomM reports';
  }

  if (problem) {
    // Never leave a file we know is wrong where a later resume would build on it.
    await rm(partPath, { force: true });
    throw new LauncherError('download_failed', `The download is corrupt: ${problem}.`);
  }
}

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz']);

const ARCHIVE_SIGNATURES: { offset: number; bytes: number[] }[] = [
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // zip
  { offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] }, // 7z
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] }, // rar
  { offset: 0, bytes: [0x1f, 0x8b] }, // gzip
  { offset: 0, bytes: [0x42, 0x5a, 0x68] }, // bzip2
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] }, // xz
  { offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] }, // tar
];

/**
 * Whether RomM hashes what is inside this file rather than the file. It decides that by
 * extension or by content, so a zip under another name counts too.
 */
async function isArchive(path: string, name: string): Promise<boolean> {
  if (ARCHIVE_EXTENSIONS.has(extname(name).toLowerCase())) return true;

  const head = Buffer.alloc(262);
  const file = await open(path, 'r');
  try {
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    return ARCHIVE_SIGNATURES.some(
      ({ offset, bytes }) =>
        offset + bytes.length <= bytesRead &&
        bytes.every((byte, index) => head[offset + index] === byte),
    );
  } finally {
    await file.close();
  }
}

async function md5Of(path: string): Promise<string> {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
