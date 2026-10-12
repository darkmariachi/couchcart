import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountDirFor, adoptLegacyData } from '../src/main/accounts';
import { DataPaths } from '../src/main/paths';

const SERVER = 'https://romm.example.lan';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-accounts-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function put(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('accountDirFor', () => {
  it('gives each person on each server a folder of their own', () => {
    const alice = accountDirFor(dir, SERVER, 'alice');

    expect(accountDirFor(dir, SERVER, 'alice')).toBe(alice);
    expect(accountDirFor(dir, SERVER, 'bob')).not.toBe(alice);
    expect(accountDirFor(dir, 'https://other.example', 'alice')).not.toBe(alice);
  });

  it('keeps the folder name readable and safe', () => {
    expect(basename(accountDirFor(dir, SERVER, 'alice'))).toMatch(/^alice-[0-9a-f]{10}$/);
    expect(basename(accountDirFor(dir, SERVER, '../../etc'))).toMatch(/^_+etc-[0-9a-f]{10}$/);
    expect(basename(accountDirFor(dir, SERVER, 'ünï@x.io'))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('keeps one account out of another account’s saves', () => {
    let account = accountDirFor(dir, SERVER, 'alice');
    const paths = new DataPaths(
      dir,
      () => null,
      () => account,
    );
    const aliceSaves = paths.savesDir('n64');

    account = accountDirFor(dir, SERVER, 'bob');

    expect(paths.savesDir('n64')).not.toBe(aliceSaves);
    expect(paths.statesDir('n64')).toContain(basename(account));
    // Games are the same files whoever plays them, so the cache stays shared.
    expect(paths.romFile('n64', 'a.z64')).toBe(join(dir, 'roms', 'n64', 'a.z64'));
  });
});

describe('adoptLegacyData', () => {
  it('moves saves from the old shared layout into the first account to sign in', () => {
    put(join(dir, 'saves', 'n64', 'Game.srm'), 'progress');
    put(join(dir, 'states', 'n64', 'Game.state1'), 'state');
    put(join(dir, 'save-backups', 'n64', 'Game', 'old.srm'), 'backup');
    put(join(dir, 'sync.db'), 'records');
    const account = accountDirFor(dir, SERVER, 'alice');

    expect(adoptLegacyData(dir, account)).toBe(true);

    expect(readFileSync(join(account, 'saves', 'n64', 'Game.srm'), 'utf8')).toBe('progress');
    expect(readFileSync(join(account, 'states', 'n64', 'Game.state1'), 'utf8')).toBe('state');
    expect(existsSync(join(account, 'save-backups', 'n64', 'Game', 'old.srm'))).toBe(true);
    expect(readFileSync(join(account, 'sync.db'), 'utf8')).toBe('records');
    expect(existsSync(join(dir, 'saves'))).toBe(false);
  });

  it('gives the old data to one account only', () => {
    put(join(dir, 'saves', 'n64', 'Game.srm'), 'progress');
    adoptLegacyData(dir, accountDirFor(dir, SERVER, 'alice'));
    const bob = accountDirFor(dir, SERVER, 'bob');

    expect(adoptLegacyData(dir, bob)).toBe(false);
    expect(existsSync(bob)).toBe(false);
  });

  it('leaves an account that already has a folder alone', () => {
    const account = accountDirFor(dir, SERVER, 'alice');
    put(join(account, 'saves', 'n64', 'Game.srm'), 'current');
    put(join(dir, 'saves', 'n64', 'Game.srm'), 'stale leftover');

    expect(adoptLegacyData(dir, account)).toBe(false);
    expect(readFileSync(join(account, 'saves', 'n64', 'Game.srm'), 'utf8')).toBe('current');
  });

  it('does nothing on a fresh install', () => {
    expect(adoptLegacyData(dir, accountDirFor(dir, SERVER, 'alice'))).toBe(false);
  });
});
