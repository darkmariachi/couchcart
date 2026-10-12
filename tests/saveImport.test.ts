import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataPaths } from '../src/main/paths';
import {
  findImportCandidates,
  importCandidates,
  readRetroArchSaveDirs,
  resolveConfigDir,
  toPreview,
  type ImportableRom,
} from '../src/main/saves/saveImport';

const roms: ImportableRom[] = [
  { fs_name: 'Super Mario 64 (U) [!].z64', name: 'Super Mario 64', platform_slug: 'n64' },
  // The same game as two dumps: both map to the same save file.
  { fs_name: 'Mario Kart 64 (U).z64', name: 'Mario Kart 64', platform_slug: 'n64' },
  { fs_name: 'Mario Kart 64 (U).v64', name: 'Mario Kart 64', platform_slug: 'n64' },
  { fs_name: 'Tetris.gb', name: 'Tetris', platform_slug: 'gb' },
  { fs_name: 'Tetris.nes', name: 'Tetris', platform_slug: 'nes' },
];

let dir: string;
let retroarch: string;
let paths: DataPaths;
let sources: { saves: string; states: string };

function put(path: string, content: string, ageSeconds = 0): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const when = new Date(Date.UTC(2026, 0, 1) - ageSeconds * 1000);
  utimesSync(path, when, when);
}

const scan = () => findImportCandidates(sources, roms, paths);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'couchcart-import-'));
  retroarch = join(dir, 'RetroArch');
  sources = { saves: join(retroarch, 'saves'), states: join(retroarch, 'states') };
  paths = new DataPaths(join(dir, 'launcher'), () => null);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('finding saves to import', () => {
  it('matches saves and states to library games by name', async () => {
    put(join(sources.saves, 'Super Mario 64 (U) [!].srm'), 'mario');
    put(join(sources.states, 'Super Mario 64 (U) [!].state1'), 'slot1');
    put(join(sources.states, 'Super Mario 64 (U) [!].state.auto'), 'auto');

    const candidates = await scan();

    expect(toPreview(candidates)).toEqual({ saves: 1, states: 2, games: ['Super Mario 64'] });
    expect(candidates.find((candidate) => candidate.kind === 'save')?.targetPath).toBe(
      join(dir, 'launcher', 'saves', 'n64', 'Super Mario 64 (U) [!].srm'),
    );
  });

  it('looks inside per-core folders and prefers the most recently written copy', async () => {
    put(join(sources.saves, 'Mario Kart 64 (U).srm'), 'older', 3600);
    put(join(sources.saves, 'Mupen64Plus-Next', 'Mario Kart 64 (U).srm'), 'newer');

    const candidates = await scan();

    expect(candidates).toHaveLength(1);
    expect(readFileSync(candidates[0]?.sourcePath ?? '', 'utf8')).toBe('newer');
  });

  it('ignores games that are not in the library, thumbnails and unrelated files', async () => {
    put(join(sources.saves, 'Some Other Game.srm'), 'x');
    put(join(sources.saves, 'User', 'notes.txt'), 'x');
    put(join(sources.states, 'Super Mario 64 (U) [!].state1.png'), 'thumbnail');
    put(join(sources.saves, 'a', 'b', 'Super Mario 64 (U) [!].srm'), 'too deep');

    expect(await scan()).toEqual([]);
  });

  it('skips a name that exists on two platforms rather than guessing', async () => {
    put(join(sources.saves, 'Tetris.srm'), 'which tetris?');

    expect(await scan()).toEqual([]);
  });

  it('never offers a save the launcher already has', async () => {
    put(join(sources.saves, 'Super Mario 64 (U) [!].srm'), 'retroarch copy');
    put(join(paths.savesDir('n64'), 'Super Mario 64 (U) [!].srm'), 'launcher copy');

    expect(await scan()).toEqual([]);
  });

  it('returns nothing when RetroArch has no save folders', async () => {
    expect(await scan()).toEqual([]);
  });
});

describe('importing', () => {
  it('copies the files and leaves the originals in place', async () => {
    const source = join(sources.saves, 'Super Mario 64 (U) [!].srm');
    put(source, 'mario');

    const imported = await importCandidates(await scan());

    expect(imported).toBe(1);
    expect(readFileSync(join(paths.savesDir('n64'), 'Super Mario 64 (U) [!].srm'), 'utf8')).toBe(
      'mario',
    );
    expect(readFileSync(source, 'utf8')).toBe('mario');
    expect(await scan()).toEqual([]); // a second run finds nothing left to do
  });

  it('does not overwrite a file that appeared after the scan', async () => {
    put(join(sources.saves, 'Super Mario 64 (U) [!].srm'), 'retroarch copy');
    const candidates = await scan();
    put(join(paths.savesDir('n64'), 'Super Mario 64 (U) [!].srm'), 'played meanwhile');

    expect(await importCandidates(candidates)).toBe(0);
    expect(readFileSync(join(paths.savesDir('n64'), 'Super Mario 64 (U) [!].srm'), 'utf8')).toBe(
      'played meanwhile',
    );
  });
});

describe('RetroArch folder settings', () => {
  it('reads the save folders from retroarch.cfg', async () => {
    put(
      join(retroarch, 'retroarch.cfg'),
      'video_fullscreen = "true"\nsavefile_directory = ":\\saves"\nsavestate_directory = "D:\\States"\n',
    );

    const dirs = await readRetroArchSaveDirs(retroarch);

    expect(dirs.saves).toBe(join(retroarch, '\\saves'));
    expect(dirs.states).toBe(resolveConfigDir('D:\\States', retroarch, 'states'));
  });

  it('falls back to the default folders', async () => {
    expect(await readRetroArchSaveDirs(retroarch)).toEqual({
      saves: join(retroarch, 'saves'),
      states: join(retroarch, 'states'),
    });
    expect(resolveConfigDir('default', retroarch, 'saves')).toBe(join(retroarch, 'saves'));
  });
});
