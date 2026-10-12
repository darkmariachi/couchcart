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
      openExternal: () => {},
    },
  });
}

/** Makes every API request fail the way an unreachable server does. */
function goOffline(): void {
  fake.server.use(http.all(`${BASE_URL}/api/*`, () => HttpResponse.error()));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'couchcart-offline-'));
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

describe('collections', () => {
  const collection = (overrides: object) => ({
    id: 1,
    name: 'RPGs',
    description: '',
    rom_ids: [1, 2],
    rom_count: 2,
    path_cover_small: null,
    path_covers_small: ['/assets/a.png', '/assets/b.png'],
    is_favorite: false,
    ...overrides,
  });

  function serveCollections(regular: object[], smart: object[] = []): void {
    fake.server.use(
      http.get(`${BASE_URL}/api/collections`, () => HttpResponse.json(regular)),
      http.get(`${BASE_URL}/api/collections/smart`, () => HttpResponse.json(smart)),
      http.get(`${BASE_URL}/api/collections/virtual`, () => HttpResponse.json([])),
    );
  }

  it('lists favourites first, then by name, and hides empty collections', async () => {
    serveCollections(
      [
        collection({ id: 1, name: 'RPGs' }),
        collection({ id: 2, name: 'Empty', rom_count: 0, rom_ids: [] }),
        collection({ id: 3, name: 'Favourites', is_favorite: true }),
      ],
      [collection({ id: 9, name: 'Action' })],
    );

    const collections = await app.listCollections();

    expect(collections.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'regular:Favourites',
      'smart:Action',
      'regular:RPGs',
    ]);
    expect(collections[0]).toMatchObject({ isFavorites: true, romCount: 2 });
    expect(collections[1]?.coverPaths).toEqual(['/assets/a.png', '/assets/b.png']);
  });

  it('shows no collections, rather than an error, for a session without access to them', async () => {
    fake.server.use(
      http.get(`${BASE_URL}/api/collections`, () =>
        HttpResponse.json({ detail: 'Forbidden' }, { status: 403 }),
      ),
    );

    expect(await app.listCollections()).toEqual([]);
    await expect(app.setFavorite(1, true)).rejects.toThrow(/sign in again/i);
  });

  it('adds a game to the favourites collection, creating it on first use', async () => {
    const calls: string[] = [];
    serveCollections([]);
    fake.server.use(
      http.post(`${BASE_URL}/api/collections`, ({ request }) => {
        calls.push(`create ${new URL(request.url).searchParams.get('is_favorite')}`);
        return HttpResponse.json(collection({ id: 7, name: 'Favourites', is_favorite: true }));
      }),
      http.post(`${BASE_URL}/api/collections/7/roms`, async ({ request }) => {
        calls.push(`add ${JSON.stringify(await request.json())}`);
        return HttpResponse.json({});
      }),
    );

    await app.setFavorite(21, true);

    expect(calls).toEqual(['create true', 'add {"rom_ids":[21]}']);
  });
});
