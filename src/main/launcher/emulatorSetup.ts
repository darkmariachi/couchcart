import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import type { SetupProgress } from '../../shared/ipc';
import { LauncherError } from '../errors';
import { log } from '../logging/logger';
import { coreFileExtension } from './cores';

const execFileAsync = promisify(execFile);

/**
 * Everything here comes from libretro's own build server, at the user's request. The
 * launcher ships neither RetroArch nor any core.
 */
const BUILDBOT = 'https://buildbot.libretro.com';
/** Used when the list of releases cannot be read. */
const FALLBACK_VERSION = '1.22.2';
const CORE_NAME = /^[a-z0-9_]+_libretro$/;

type Fetch = typeof fetch;
export type ProgressListener = (progress: SetupProgress) => void;
/** Unpacks `archive` into `destination`; `only` limits it to one file, without its folder. */
export type Extract = (archive: string, destination: string, only?: string) => Promise<void>;

/** The folder names libretro's server uses for this kind of PC, or null when it has none. */
export function buildbotPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (arch !== 'x64') return null;
  if (platform === 'win32') return 'windows/x86_64';
  if (platform === 'linux') return 'linux/x86_64';
  return null;
}

/** RetroArch itself is only offered as a self-contained download for Windows. */
export function canSetUpRetroArch(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  return platform === 'win32' && arch === 'x64';
}

/** Runs the 7-Zip program shipped with the launcher. */
export function createExtractor(sevenZipPath: string): Extract {
  return async (archive, destination, only) => {
    await mkdir(destination, { recursive: true });
    // npm does not keep the program's executable flag on Linux. The packaged copy is made
    // executable at build time; this covers a run from source.
    if (process.platform !== 'win32') await chmod(sevenZipPath, 0o755).catch(() => undefined);
    // "e" drops folder names, so a file named in `only` cannot land outside `destination`.
    const args = only
      ? ['e', '-y', `-o${destination}`, archive, only]
      : ['x', '-y', `-o${destination}`, archive];
    try {
      await execFileAsync(sevenZipPath, args, {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      log.warn(`Unpacking ${archive} failed`, error);
      throw new LauncherError('download_failed', 'The downloaded file could not be unpacked.');
    }
  };
}

/** The newest stable RetroArch version listed on the server. */
export async function latestRetroArchVersion(fetchImpl: Fetch = fetch): Promise<string> {
  try {
    const response = await fetchImpl(`${BUILDBOT}/stable/`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const versions = parseStableVersions(await response.text());
    const newest = versions.at(-1);
    if (newest) return newest;
  } catch (error) {
    log.warn('Could not read the list of RetroArch releases; using a known one', error);
  }
  return FALLBACK_VERSION;
}

/** Versions named in the server's folder listing, oldest first. */
export function parseStableVersions(listing: string): string[] {
  const found = new Set(
    [...listing.matchAll(/\/stable\/(\d+\.\d+\.\d+)\//g)].map((match) => match[1] ?? ''),
  );
  const parts = (version: string) => version.split('.').map(Number);
  return [...found].sort((a, b) => {
    const [x, y] = [parts(a), parts(b)];
    return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0) || (x[2] ?? 0) - (y[2] ?? 0);
  });
}

/** Cores the server offers, with the checksum it lists for each download. */
export function parseCoreIndex(index: string, platform: NodeJS.Platform): Map<string, number> {
  const suffix = `${coreFileExtension(platform)}.zip`;
  const cores = new Map<string, number>();
  for (const line of index.split('\n')) {
    const [, checksum, file] = line.trim().split(/\s+/);
    if (!checksum || !file?.endsWith(suffix)) continue;
    const name = file.slice(0, -suffix.length);
    if (CORE_NAME.test(name) && /^[0-9a-f]{8}$/i.test(checksum)) {
      cores.set(name, Number.parseInt(checksum, 16));
    }
  }
  return cores;
}

export interface SetupDeps {
  extract: Extract;
  fetch?: Fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  onProgress?: ProgressListener;
}

/**
 * Downloads RetroArch and unpacks it into `targetDir`, replacing nothing: the folder only
 * appears once everything is in place. Resolves with the path of the program.
 */
export async function setUpRetroArch(targetDir: string, deps: SetupDeps): Promise<string> {
  const { extract, fetch: fetchImpl = fetch, onProgress = () => {} } = deps;
  if (!canSetUpRetroArch(deps.platform, deps.arch)) {
    throw new LauncherError(
      'invalid_input',
      'RetroArch can only be set up automatically on 64-bit Windows.',
    );
  }

  const workDir = `${targetDir}.setup`;
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    const version = await latestRetroArchVersion(fetchImpl);
    const archive = join(workDir, 'RetroArch.7z');
    await download(
      `${BUILDBOT}/stable/${version}/windows/x86_64/RetroArch.7z`,
      archive,
      fetchImpl,
      (receivedBytes, totalBytes) =>
        onProgress({ item: 'RetroArch', stage: 'downloading', receivedBytes, totalBytes }),
    );

    onProgress({ item: 'RetroArch', stage: 'unpacking', receivedBytes: 0, totalBytes: null });
    const unpacked = join(workDir, 'unpacked');
    await extract(archive, unpacked);
    const root = await findProgramFolder(unpacked, 'retroarch.exe');
    if (!root) {
      throw new LauncherError('download_failed', 'The download did not contain RetroArch.');
    }

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await rename(root, targetDir);
    log.info(`RetroArch ${version} set up in ${targetDir}`);
    return join(targetDir, 'retroarch.exe');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The archive may or may not wrap everything in one folder; look one level down too. */
async function findProgramFolder(dir: string, program: string): Promise<string | null> {
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );
  if (await exists(join(dir, program))) return dir;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(join(dir, entry.name, program)))) {
      return join(dir, entry.name);
    }
  }
  return null;
}

/**
 * Installs the first of `candidates` that the server offers into `coresDir`, and resolves
 * with its name. The core is checked against the checksum the server lists for it.
 */
export async function installCore(
  candidates: string[],
  coresDir: string,
  deps: SetupDeps,
): Promise<string> {
  const { extract, fetch: fetchImpl = fetch, onProgress = () => {} } = deps;
  const platform = deps.platform ?? process.platform;
  const folder = buildbotPlatform(platform, deps.arch);
  if (!folder) {
    throw new LauncherError('invalid_input', 'Cores cannot be downloaded for this kind of PC.');
  }
  if (candidates.some((name) => !CORE_NAME.test(name))) {
    throw new LauncherError('invalid_input', 'That is not a core name.');
  }

  const base = `${BUILDBOT}/nightly/${folder}/latest`;
  const response = await fetchImpl(`${base}/.index-extended`).catch(() => null);
  if (!response?.ok) {
    throw new LauncherError('network', 'The list of cores could not be downloaded.');
  }
  const available = parseCoreIndex(await response.text(), platform);
  const core = candidates.find((name) => available.has(name));
  if (!core) {
    throw new LauncherError(
      'core_missing',
      'None of the cores for this platform can be downloaded automatically.',
    );
  }

  const fileName = `${core}${coreFileExtension(platform)}`;
  const item = core.replace(/_libretro$/, '');
  await mkdir(coresDir, { recursive: true });
  // Work in a folder of its own so a failed download never leaves a broken core behind.
  const workDir = join(coresDir, `.${core}.download`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    const archive = join(workDir, `${fileName}.zip`);
    await download(`${base}/${fileName}.zip`, archive, fetchImpl, (receivedBytes, totalBytes) =>
      onProgress({ item, stage: 'downloading', receivedBytes, totalBytes }),
    );
    onProgress({ item, stage: 'unpacking', receivedBytes: 0, totalBytes: null });
    const unpacked = join(workDir, 'unpacked');
    await extract(archive, unpacked, fileName);
    const contents = await readFile(join(unpacked, fileName)).catch(() => null);
    if (!contents) {
      throw new LauncherError('download_failed', 'The download did not contain the core.');
    }
    // The server lists the checksum of the core itself, not of the zip around it.
    if (crc32(contents) !== available.get(core)) {
      throw new LauncherError(
        'download_failed',
        'The downloaded core did not match its checksum. Try again.',
      );
    }
    await rename(join(unpacked, fileName), join(coresDir, fileName));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  log.info(`Core ${core} installed in ${coresDir}`);
  return core;
}

async function download(
  url: string,
  destination: string,
  fetchImpl: Fetch,
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    log.warn(`Downloading ${url} failed`, error);
    throw new LauncherError('network', 'The download server could not be reached.');
  }
  if (!response.ok || !response.body) {
    throw new LauncherError('download_failed', `The download failed (HTTP ${response.status}).`);
  }

  const length = Number(response.headers.get('content-length'));
  const totalBytes = Number.isFinite(length) && length > 0 ? length : null;
  let receivedBytes = 0;
  let lastReport = 0;
  onProgress(0, totalBytes);
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    if (Date.now() - lastReport < 200) return;
    lastReport = Date.now();
    onProgress(receivedBytes, totalBytes);
  });
  try {
    await pipeline(body, createWriteStream(destination));
  } catch (error) {
    log.warn(`Downloading ${url} was interrupted`, error);
    throw new LauncherError('download_failed', 'The download was interrupted. Try again.');
  }
  onProgress(receivedBytes, totalBytes);
}
