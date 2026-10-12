import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '../src/shared/ipc';
import {
  buildbotPlatform,
  canSetUpRetroArch,
  installCore,
  latestRetroArchVersion,
  parseCoreIndex,
  parseStableVersions,
  setUpRetroArch,
  type Extract,
} from '../src/main/launcher/emulatorSetup';

const BUILDBOT = 'https://buildbot.libretro.com';
const hex = (value: number) => value.toString(16).padStart(8, '0');

/** Answers each URL from a table; anything else is a 404. */
function fakeFetch(pages: Record<string, string | Buffer>) {
  return vi.fn(async (input: string | URL | Request) => {
    const body = pages[String(input)];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(Buffer.from(body)), {
      headers: { 'content-length': String(Buffer.byteLength(body)) },
    });
  }) as unknown as typeof fetch;
}

describe('what can be downloaded for a PC', () => {
  it('knows the folders libretro uses', () => {
    expect(buildbotPlatform('win32', 'x64')).toBe('windows/x86_64');
    expect(buildbotPlatform('linux', 'x64')).toBe('linux/x86_64');
    expect(buildbotPlatform('linux', 'arm64')).toBeNull();
    expect(buildbotPlatform('darwin', 'x64')).toBeNull();
  });

  it('only offers RetroArch itself on 64-bit Windows', () => {
    expect(canSetUpRetroArch('win32', 'x64')).toBe(true);
    expect(canSetUpRetroArch('linux', 'x64')).toBe(false);
    expect(canSetUpRetroArch('win32', 'ia32')).toBe(false);
  });
});

describe('RetroArch releases', () => {
  const listing = ['1.9.14', '1.22.2', '1.10.0', '1.9.2', '1.22.2']
    .map((version) => `<a href="/stable/${version}/">${version}</a>`)
    .join('\n');

  it('orders versions by number, not by spelling', () => {
    expect(parseStableVersions(listing)).toEqual(['1.9.2', '1.9.14', '1.10.0', '1.22.2']);
  });

  it('picks the newest one listed', async () => {
    const fetch = fakeFetch({ [`${BUILDBOT}/stable/`]: `${listing}<a href="/stable/1.23.0/">` });

    expect(await latestRetroArchVersion(fetch)).toBe('1.23.0');
  });

  it('falls back to a known release when the list cannot be read', async () => {
    expect(await latestRetroArchVersion(fakeFetch({}))).toMatch(/^\d+\.\d+\.\d+$/);
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await latestRetroArchVersion(offline)).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('parseCoreIndex', () => {
  const index = [
    '2026-10-11 dc6ebf99 mgba_libretro.dll.zip',
    '2026-10-11 0000abcd mupen64plus_next_libretro.dll.zip',
    '2026-10-11 521e6850 gambatte_libretro.so.zip',
    '2026-10-11 nothex00 broken_libretro.dll.zip',
    '2026-10-11 12345678 ../evil_libretro.dll.zip',
    '',
  ].join('\n');

  it('lists the cores for this kind of PC with their checksums', () => {
    expect([...parseCoreIndex(index, 'win32')]).toEqual([
      ['mgba_libretro', 0xdc6ebf99],
      ['mupen64plus_next_libretro', 0xabcd],
    ]);
    expect([...parseCoreIndex(index, 'linux').keys()]).toEqual(['gambatte_libretro']);
  });
});

describe('installCore', () => {
  let dir: string;
  let extracted: { archive: string; destination: string; only?: string }[];
  const zip = Buffer.from('pretend this is a zip with a core in it');
  const coreFile = Buffer.from('pretend this is the core itself');
  const base = `${BUILDBOT}/nightly/windows/x86_64/latest`;
  const deps = (pages: Record<string, string | Buffer>, progress: SetupProgress[] = []) => ({
    fetch: fakeFetch(pages),
    platform: 'win32' as const,
    arch: 'x64',
    onProgress: (update: SetupProgress) => progress.push(update),
    extract: (async (archive, destination, only) => {
      extracted.push({ archive, destination, only });
      // What 7-Zip would do: put the one requested file in the folder.
      mkdirSync(destination, { recursive: true });
      if (only) await writeFile(join(destination, only), coreFile);
    }) satisfies Extract,
  });
  const index = (checksum: number) =>
    `2026-10-11 ${hex(checksum)} mupen64plus_next_libretro.dll.zip\n`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'couchcart-cores-'));
    extracted = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('installs the first candidate the server offers and reports progress', async () => {
    const progress: SetupProgress[] = [];
    const cores = join(dir, 'cores');

    const core = await installCore(
      ['parallel_n64_libretro', 'mupen64plus_next_libretro'],
      cores,
      deps(
        {
          [`${base}/.index-extended`]: index(crc32(coreFile)),
          [`${base}/mupen64plus_next_libretro.dll.zip`]: zip,
        },
        progress,
      ),
    );

    expect(core).toBe('mupen64plus_next_libretro');
    expect(existsSync(join(cores, 'mupen64plus_next_libretro.dll'))).toBe(true);
    expect(extracted).toMatchObject([{ only: 'mupen64plus_next_libretro.dll' }]);
    expect(readdirSync(cores)).toEqual(['mupen64plus_next_libretro.dll']); // no download left over
    expect(readFileSync(join(cores, 'mupen64plus_next_libretro.dll'))).toEqual(coreFile);
    expect(progress.at(0)).toMatchObject({ item: 'mupen64plus_next', stage: 'downloading' });
    expect(progress.at(-1)).toMatchObject({ stage: 'unpacking' });
    expect(progress.some((update) => update.receivedBytes === zip.length)).toBe(true);
  });

  it('refuses a download that does not match its checksum', async () => {
    const cores = join(dir, 'cores');

    await expect(
      installCore(
        ['mupen64plus_next_libretro'],
        cores,
        deps({
          [`${base}/.index-extended`]: index((crc32(coreFile) ^ 1) >>> 0),
          [`${base}/mupen64plus_next_libretro.dll.zip`]: zip,
        }),
      ),
    ).rejects.toMatchObject({ code: 'download_failed' });
    expect(readdirSync(cores)).toEqual([]);
  });

  it('says so when no candidate can be downloaded', async () => {
    await expect(
      installCore(['rare_libretro'], dir, deps({ [`${base}/.index-extended`]: index(1) })),
    ).rejects.toMatchObject({ code: 'core_missing' });
  });

  it('reports an unreachable server as a network problem', async () => {
    await expect(installCore(['mupen64plus_next_libretro'], dir, deps({}))).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('rejects anything that is not a core name before contacting the server', async () => {
    const options = deps({});

    await expect(installCore(['../../evil_libretro'], dir, options)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(options.fetch).not.toHaveBeenCalled();
  });
});

describe('setUpRetroArch', () => {
  let dir: string;
  const archive = Buffer.from('pretend this is RetroArch.7z');
  const pages = {
    [`${BUILDBOT}/stable/`]: '<a href="/stable/1.22.2/">',
    [`${BUILDBOT}/stable/1.22.2/windows/x86_64/RetroArch.7z`]: archive,
  };
  /** Unpacks into a wrapping folder, as the real archive does. */
  const extract: Extract = async (_archive, destination) => {
    mkdirSync(join(destination, 'RetroArch-Win64', 'cores'), { recursive: true });
    await writeFile(join(destination, 'RetroArch-Win64', 'retroarch.exe'), 'program');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'couchcart-emulator-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('downloads the newest release and leaves only the finished folder', async () => {
    const target = join(dir, 'emulator', 'RetroArch');
    const progress: SetupProgress[] = [];

    const program = await setUpRetroArch(target, {
      extract,
      fetch: fakeFetch(pages),
      platform: 'win32',
      arch: 'x64',
      onProgress: (update) => progress.push(update),
    });

    expect(program).toBe(join(target, 'retroarch.exe'));
    expect(readFileSync(program, 'utf8')).toBe('program');
    expect(existsSync(join(target, 'cores'))).toBe(true);
    expect(readdirSync(join(dir, 'emulator'))).toEqual(['RetroArch']);
    expect(progress.map((update) => update.stage)).toContain('unpacking');
    expect(progress.at(0)).toMatchObject({ item: 'RetroArch', totalBytes: archive.length });
  });

  it('leaves nothing behind when the download fails', async () => {
    const target = join(dir, 'emulator', 'RetroArch');

    await expect(
      setUpRetroArch(target, {
        extract,
        fetch: fakeFetch({ [`${BUILDBOT}/stable/`]: '<a href="/stable/1.22.2/">' }),
        platform: 'win32',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ code: 'download_failed' });
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(join(dir, 'emulator'))).toEqual([]);
  });

  it('fails when the archive holds no RetroArch', async () => {
    await expect(
      setUpRetroArch(join(dir, 'RetroArch'), {
        extract: async (_archive, destination) => {
          mkdirSync(destination, { recursive: true });
        },
        fetch: fakeFetch(pages),
        platform: 'win32',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ code: 'download_failed' });
  });

  it('is not offered on Linux', async () => {
    await expect(
      setUpRetroArch(join(dir, 'RetroArch'), {
        extract,
        fetch: fakeFetch(pages),
        platform: 'linux',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
