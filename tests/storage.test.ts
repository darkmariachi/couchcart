import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TokenSet } from '../src/main/romm/auth';
import { CredentialStore, type Encryptor } from '../src/main/romm/credentials';
import { migrateSettings } from '../src/main/settings/schema';
import { SettingsStore } from '../src/main/settings/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'romm-launcher-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SettingsStore', () => {
  const file = () => join(dir, 'settings.json');

  it('starts from defaults without creating a file', () => {
    const store = new SettingsStore(file(), 'LIVINGROOM-PC');

    expect(store.get()).toMatchObject({
      version: 3,
      serverUrl: null,
      username: null,
      deviceName: 'LIVINGROOM-PC',
      retroarch: { executablePath: null, fullscreen: true },
      cacheDir: null,
    });
    expect(existsSync(file())).toBe(false);
  });

  it('persists updates across instances', () => {
    new SettingsStore(file(), 'PC').update({ serverUrl: 'https://romm.example.lan' });

    const reloaded = new SettingsStore(file(), 'OTHER-DEFAULT');
    expect(reloaded.get().serverUrl).toBe('https://romm.example.lan');
    expect(reloaded.get().deviceName).toBe('PC');
  });

  it('rejects invalid updates and keeps the previous value', () => {
    const store = new SettingsStore(file(), 'PC');

    expect(() => store.update({ serverUrl: 'not a url' })).toThrow();
    expect(store.get().serverUrl).toBeNull();
  });

  it.each([
    ['corrupt JSON', '{ "version": 1, '],
    ['a wrong shape', JSON.stringify({ version: 3, serverUrl: 42 })],
    ['a newer version', JSON.stringify({ version: 99, somethingNew: true })],
  ])('falls back to defaults on %s and keeps the original for inspection', (_, content) => {
    writeFileSync(file(), content);

    const store = new SettingsStore(file(), 'PC');

    expect(store.get().serverUrl).toBeNull();
    expect(readFileSync(`${file()}.invalid`, 'utf8')).toBe(content);
  });

  it('upgrades a version 1 file without losing what it held', () => {
    const v1 = {
      version: 1,
      serverUrl: 'https://romm.example.lan',
      username: 'player',
      deviceName: 'LIVINGROOM-PC',
    };
    writeFileSync(file(), JSON.stringify(v1));

    const settings = new SettingsStore(file(), 'IGNORED').get();

    expect(settings).toMatchObject({ ...v1, version: 3, deviceId: null, saveBackupCount: 10 });
    expect(settings.retroarch).toEqual({
      executablePath: null,
      coresDir: null,
      fullscreen: true,
      extraArgs: [],
    });
    expect(settings.coreOverrides).toEqual({ platforms: {}, games: {} });
    expect(existsSync(`${file()}.invalid`)).toBe(false);
  });

  it('does not treat unversioned data as settings', () => {
    expect(migrateSettings({ serverUrl: 'https://x.example' })).toBeNull();
    expect(migrateSettings('nope')).toBeNull();
  });
});

describe('CredentialStore', () => {
  const file = () => join(dir, 'credentials.bin');
  const SERVER = 'https://romm.example.lan';
  const tokens: TokenSet = {
    accessToken: 'access-secret',
    accessExpiresAt: 1000,
    refreshToken: 'refresh-secret',
    refreshExpiresAt: 2000,
  };

  // Stand-in for DPAPI: reversible, but the output never contains the plain text.
  const xorEncryptor = (available = true): Encryptor => ({
    isAvailable: () => available,
    encrypt: (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
    decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8'),
  });

  it('round-trips tokens through an encrypted file', () => {
    new CredentialStore(file(), xorEncryptor()).forServer(SERVER).save(tokens);

    const onDisk = readFileSync(file()).toString('latin1');
    expect(onDisk).not.toContain('access-secret');
    expect(onDisk).not.toContain('refresh-secret');
    expect(new CredentialStore(file(), xorEncryptor()).forServer(SERVER).load()).toEqual(tokens);
  });

  it('does not hand tokens to a different server', () => {
    const store = new CredentialStore(file(), xorEncryptor());
    store.forServer(SERVER).save(tokens);

    expect(store.forServer('https://evil.example').load()).toBeNull();
    expect(
      new CredentialStore(file(), xorEncryptor()).forServer('https://evil.example').load(),
    ).toBeNull();
  });

  it('keeps the session in memory only when OS encryption is unavailable', () => {
    const store = new CredentialStore(file(), xorEncryptor(false));
    store.forServer(SERVER).save(tokens);

    expect(existsSync(file())).toBe(false);
    expect(store.forServer(SERVER).load()).toEqual(tokens);
    expect(new CredentialStore(file(), xorEncryptor(false)).forServer(SERVER).load()).toBeNull();
  });

  it('treats an undecryptable file as logged out', () => {
    writeFileSync(file(), 'garbage');

    expect(new CredentialStore(file(), xorEncryptor()).forServer(SERVER).load()).toBeNull();
  });

  it('removes the file on clear', () => {
    const tokenStore = new CredentialStore(file(), xorEncryptor()).forServer(SERVER);
    tokenStore.save(tokens);
    tokenStore.clear();

    expect(existsSync(file())).toBe(false);
    expect(tokenStore.load()).toBeNull();
  });
});
