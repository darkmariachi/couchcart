import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSession } from '../src/main/romm/auth';
import { createAuthenticatedFetch } from '../src/main/romm/authenticatedFetch';
import { RommClient, normalizeServerUrl, probeServer } from '../src/main/romm/client';
import { NetworkError, RommApiError } from '../src/main/romm/errors';
import {
  BASE_URL,
  MemoryTokenStore,
  PASSWORD,
  USERNAME,
  createFakeRomm,
  romFixture,
  type FakeRomm,
} from './helpers/fakeRomm';

let fake: FakeRomm;
let auth: AuthSession;
let client: RommClient;
const sleep = vi.fn(async () => {});

beforeAll(() => {
  fake = createFakeRomm();
  fake.server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => fake.server.close());

beforeEach(async () => {
  fake.tokenRequests.length = 0;
  fake.apiRequests.length = 0;
  fake.roms = [1, 2, 3].map((id) => romFixture(id));
  sleep.mockClear();

  auth = new AuthSession(BASE_URL, new MemoryTokenStore());
  await auth.login(USERNAME, PASSWORD);
  client = new RommClient(BASE_URL, createAuthenticatedFetch(auth, { sleep }));
});
afterEach(() => fake.server.resetHandlers());

/** Responds with each status in turn, then falls through to the normal handler. */
function failFirst(method: 'get' | 'post', path: string, statuses: number[]) {
  const remaining = [...statuses];
  fake.server.use(
    http[method](`${BASE_URL}${path}`, () => {
      const status = remaining.shift();
      return status === undefined ? undefined : HttpResponse.json({}, { status });
    }),
  );
}

describe('authenticated requests', () => {
  it('send the bearer token', async () => {
    const platforms = await client.listPlatforms();

    expect(platforms.map((platform) => platform.slug)).toEqual(['n64']);
    expect(fake.apiRequests[0]?.headers.get('authorization')).toMatch(/^Bearer /);
  });

  it('refresh and retry once when the server rejects the token', async () => {
    fake.validAccessTokens.clear(); // e.g. the server restarted with a new signing key

    const platforms = await client.listPlatforms();

    expect(platforms).toHaveLength(1);
    expect(fake.tokenRequests.at(-1)?.get('grant_type')).toBe('refresh_token');
    expect(fake.tokenRequests).toHaveLength(2);
  });

  it('give up after one refresh if the server still answers 401', async () => {
    fake.server.use(
      http.get(`${BASE_URL}/api/platforms`, () =>
        HttpResponse.json({ detail: 'Forbidden for this token' }, { status: 401 }),
      ),
    );

    await expect(client.listPlatforms()).rejects.toMatchObject({
      status: 401,
      message: 'Forbidden for this token',
    });
    expect(fake.tokenRequests).toHaveLength(2);
  });

  it('surface the API error detail', async () => {
    fake.server.use(
      http.get(`${BASE_URL}/api/roms/:id`, () =>
        HttpResponse.json({ detail: 'Rom with id 99 not found' }, { status: 404 }),
      ),
    );

    const attempt = client.getRom(99);

    await expect(attempt).rejects.toBeInstanceOf(RommApiError);
    await expect(attempt).rejects.toMatchObject({
      status: 404,
      message: 'Rom with id 99 not found',
    });
  });
});

describe('transient failures', () => {
  it('are retried with backoff for GET', async () => {
    failFirst('get', '/api/platforms', [503, 502]);

    expect(await client.listPlatforms()).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map((call) => (call as unknown as [number])[0]);
    expect(second).toBeGreaterThan(first ?? Infinity);
  });

  it('stop after the attempt budget', async () => {
    failFirst('get', '/api/platforms', [503, 503, 503]);

    await expect(client.listPlatforms()).rejects.toMatchObject({ status: 503 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('are never retried for writes', async () => {
    let calls = 0;
    fake.server.use(
      http.post(`${BASE_URL}/api/saves`, () => {
        calls++;
        return HttpResponse.json({}, { status: 503 });
      }),
    );

    const response = await client.fetchRaw('/api/saves?rom_id=1', { method: 'POST', body: 'x' });

    expect(response.status).toBe(503);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('become a NetworkError when the server stays unreachable', async () => {
    fake.server.use(http.get(`${BASE_URL}/api/platforms`, () => HttpResponse.error()));

    await expect(client.listPlatforms()).rejects.toBeInstanceOf(NetworkError);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('listing ROMs', () => {
  it('filters by platform and skips the web-UI-only extras', async () => {
    await client.listRoms({ platformId: 4, search: 'zelda', offset: 50, limit: 25 });

    const query = new URL(fake.apiRequests[0]?.url ?? '').searchParams;
    expect(query.getAll('platform_ids')).toEqual(['4']);
    expect(query.get('search_term')).toBe('zelda');
    expect(query.get('offset')).toBe('50');
    expect(query.get('limit')).toBe('25');
    expect(query.get('with_char_index')).toBe('false');
    expect(query.get('with_filter_values')).toBe('false');
    expect(query.get('with_rom_id_index')).toBe('false');
  });

  it('iterates across every page', async () => {
    fake.roms = Array.from({ length: 230 }, (_, index) => romFixture(index + 1));

    const ids: number[] = [];
    for await (const rom of client.iterateRoms({ platformId: 4 })) ids.push(rom.id);

    expect(ids).toHaveLength(230);
    expect(new Set(ids).size).toBe(230);
    expect(fake.apiRequests).toHaveLength(3); // 100 + 100 + 30
  });
});

describe('server URL handling', () => {
  it('normalizes what the user typed', () => {
    expect(normalizeServerUrl('  https://romm.example.lan/  ')).toBe('https://romm.example.lan');
    expect(normalizeServerUrl('http://192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
    expect(normalizeServerUrl('https://home.example/romm/')).toBe('https://home.example/romm');
  });

  it('rejects anything that is not http(s)', () => {
    expect(() => normalizeServerUrl('file:///etc/passwd')).toThrow(TypeError);
    expect(() => normalizeServerUrl('romm.example.lan')).toThrow(TypeError);
  });

  it('probes the version without credentials', async () => {
    expect(await probeServer(BASE_URL)).toEqual({ version: '5.4.0' });
  });
});
