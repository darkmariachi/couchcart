import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableFileLogging, log, readRecentLog } from '../src/main/logging/logger';
import { makeJwt } from './helpers/fakeRomm';

let dir: string;
const file = () => join(dir, 'logs', 'launcher.log');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'romm-launcher-log-'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  enableFileLogging(file());
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('file logging', () => {
  it('appends timestamped lines and creates the folder', () => {
    log.info('first');
    log.warn('second', new Error('boom'));

    const lines = readFileSync(file(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[info\] first$/);
    expect(lines[1]).toContain('[warn] second Error: boom');
  });

  it('never writes credentials', () => {
    const token = makeJwt(Date.now());

    log.info(`request failed with Authorization: Bearer ${token}`);
    log.warn('login', { username: 'bob', password: 'hunter2', refresh_token: token });

    const written = readFileSync(file(), 'utf8');
    expect(written).not.toContain(token);
    expect(written).not.toContain('hunter2');
    expect(written).toContain('bob');
  });

  it('rotates at one megabyte and keeps a bounded number of files', () => {
    const numbered = (index: number) => join(dir, 'logs', `launcher.${index}.log`);
    log.info('before any rotation');
    for (let generation = 1; generation <= 6; generation++) {
      appendFileSync(file(), 'x'.repeat(1024 * 1024));
      log.info(`after rotation ${generation}`);
    }

    expect(readFileSync(file(), 'utf8')).toContain('after rotation 6');
    expect(existsSync(numbered(1))).toBe(true);
    expect(existsSync(numbered(4))).toBe(true);
    expect(existsSync(numbered(5))).toBe(false);
    // The newest rotated file holds the lines written just before the last rotation.
    expect(readFileSync(numbered(1), 'utf8')).toContain('after rotation 5');
  });

  it('returns the most recent lines for copying', () => {
    for (let line = 1; line <= 10; line++) log.info(`line ${line}`);

    const recent = readRecentLog(4).trim().split('\n');

    expect(recent).toHaveLength(3); // the file ends with a newline, which counts as one
    expect(recent.at(-1)).toContain('line 10');
  });
});
