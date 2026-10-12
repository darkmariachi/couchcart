import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LauncherApp } from '../src/main/launcherApp';
import { NetworkError } from '../src/main/romm/errors';
import {
  BASE_URL,
  PASSWORD,
  USERNAME,
  createFakeRomm,
  romFixture,
  type FakeRomm,
} from './helpers/fakeRomm';

let fake: FakeRomm;
let dir: string;
let app: LauncherApp;
let onlineEvents: boolean[];

beforeAll(() => {
  fake = createFakeRomm();
  fake.server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => fake.server.close());

function createApp(): LauncherApp {
  return new LauncherApp({
    dataDir: dir,
    hostname: 'TEST-PC',
    appVersion: '0.0.0',
    // Stand-in for the OS keychain; these tests are not about credential storage.
    encryptor: {
      isAvailable: () => true,
      encrypt: (text) => Buffer.from(text, 'utf8'),
      decrypt: (data) => data.toString('utf8'),
    },
    onLaunchStateChanged: () => {},
    onDownloadsChanged: () => {},
    onOnlineChanged: (online) => onlineEvents.push(online),
    shell: {
      choosePath: async () => null,
      quit: () => {},
      toggleFullscreen: () => {},
      copyText: () => {},
      openFolder: () => {},
    },
  });
}

/** Makes every API request fail the way an unreachable server does. */
function goOffline(): void {
  fake.server.use(http.all(`${BASE_URL}/api/*`, () => HttpResponse.error()));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'romm-launcher-offline-'));
  onlineEvents = [];
  fake.roms = [1, 2, 3].map((id) => romFixture(id));
  app = createApp();
  await app.login({ serverUrl: BASE_URL, username: USERNAME, password: PASSWORD });
});
afterEach(() => {
  fake.server.resetHandlers();
  app.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('browsing while the server is unreachable', () => {
  it('shows the library as it was last seen', async () => {
    const platforms = await app.listPlatforms();
    const games = await app.listPlatformRoms(4);
    expect(games.map((game) => game.name)).toEqual(['Game 1', 'Game 2', 'Game 3']);

    goOffline();

    expect(await app.listPlatforms()).toEqual(platforms);
    expect(await app.listPlatformRoms(4)).toEqual(games);
    expect(app.isOnline()).toBe(false);
    expect(onlineEvents).toEqual([false]);
  }, 15_000);

  it('still fails for something it has never loaded', async () => {
    goOffline();

    await expect(app.listPlatformRoms(4)).rejects.toBeInstanceOf(NetworkError);
  }, 15_000);

  it('notices when the server is back and refreshes what it remembers', async () => {
    await app.listPlatformRoms(4);
    goOffline();
    await app.listPlatformRoms(4);

    fake.server.resetHandlers();
    fake.roms = [romFixture(9, { name: 'New Game' })];
    const games = await app.listPlatformRoms(4);

    expect(games.map((game) => game.name)).toEqual(['New Game']);
    expect(app.isOnline()).toBe(true);
    expect(onlineEvents).toEqual([false, true]);
  }, 15_000);

  it('remembers the library across restarts', async () => {
    const games = await app.listPlatformRoms(4);
    app.stop();

    goOffline();
    const restarted = createApp();

    expect(restarted.status().loggedIn).toBe(true);
    expect(await restarted.listPlatformRoms(4)).toEqual(games);
    restarted.stop();
  }, 15_000);
});

describe('local facts on listed games', () => {
  it('marks nothing as downloaded or synced on a fresh install', async () => {
    const [game] = await app.listPlatformRoms(4);

    expect(game).toMatchObject({ downloaded: false, syncStatus: null });
  });
});
