import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthSession, REQUESTED_SCOPES, readJwtExpiry } from '../src/main/romm/auth';
import {
  NetworkError,
  NotAuthenticatedError,
  RommApiError,
  SessionExpiredError,
} from '../src/main/romm/errors';
import {
  BASE_URL,
  MemoryTokenStore,
  PASSWORD,
  USERNAME,
  createFakeRomm,
  makeJwt,
  type FakeRomm,
} from './helpers/fakeRomm';

const START = Date.UTC(2026, 0, 1);
let now = START;
let fake: FakeRomm;
let store: MemoryTokenStore;
let auth: AuthSession;

beforeAll(() => {
  fake = createFakeRomm(() => now);
  fake.server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => fake.server.close());

beforeEach(() => {
  now = START;
  fake.tokenRequests.length = 0;
  fake.rotateRefreshToken = false;
  store = new MemoryTokenStore();
  auth = new AuthSession(BASE_URL, store, { fetch, now: () => now });
});
afterEach(() => fake.server.resetHandlers());

const expireAccessToken = () => {
  now += 31 * 60_000;
};

describe('login', () => {
  it('exchanges credentials for tokens and persists them', async () => {
    await auth.login(USERNAME, PASSWORD);

    expect(auth.isLoggedIn).toBe(true);
    expect(store.tokens?.accessExpiresAt).toBe(START + 30 * 60_000);
    expect(store.tokens?.refreshToken).toBe(fake.refreshToken);

    const form = fake.tokenRequests[0];
    expect(form?.get('grant_type')).toBe('password');
    expect(form?.get('scope')).toBe(REQUESTED_SCOPES.join(' '));
  });

  it('reports the server message for bad credentials and stays logged out', async () => {
    const attempt = auth.login(USERNAME, 'wrong');

    await expect(attempt).rejects.toBeInstanceOf(RommApiError);
    await expect(attempt).rejects.toMatchObject({
      status: 401,
      message: 'Invalid username or password',
    });
    expect(auth.isLoggedIn).toBe(false);
    expect(store.tokens).toBeNull();
  });

  it('resumes a stored session without contacting the server', async () => {
    await auth.login(USERNAME, PASSWORD);
    const resumed = new AuthSession(BASE_URL, store, { fetch, now: () => now });

    expect(await resumed.getAccessToken()).toBe(store.tokens?.accessToken);
    expect(fake.tokenRequests).toHaveLength(1);
  });
});

describe('access token', () => {
  it('throws when not logged in', async () => {
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('is reused while it is still valid', async () => {
    await auth.login(USERNAME, PASSWORD);
    const first = await auth.getAccessToken();
    now += 10 * 60_000;

    expect(await auth.getAccessToken()).toBe(first);
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('is refreshed shortly before it expires', async () => {
    await auth.login(USERNAME, PASSWORD);
    const first = await auth.getAccessToken();
    now += 29 * 60_000 + 45_000; // inside the 30 s safety margin

    const second = await auth.getAccessToken();

    expect(second).not.toBe(first);
    expect(fake.tokenRequests[1]?.get('grant_type')).toBe('refresh_token');
  });

  it('shares one refresh between concurrent callers', async () => {
    await auth.login(USERNAME, PASSWORD);
    expireAccessToken();

    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    expect(new Set(tokens).size).toBe(1);
    expect(fake.tokenRequests).toHaveLength(2); // login + a single refresh
  });

  it('does not refresh again when the rejected token was already replaced', async () => {
    await auth.login(USERNAME, PASSWORD);
    const stale = await auth.getAccessToken();
    const fresh = await auth.refresh(stale);

    expect(await auth.refresh(stale)).toBe(fresh);
    expect(fake.tokenRequests).toHaveLength(2);
  });
});

describe('refresh', () => {
  it('keeps the old refresh token when the server does not send a new one', async () => {
    await auth.login(USERNAME, PASSWORD);
    const original = store.tokens?.refreshToken;
    expireAccessToken();

    await auth.getAccessToken();

    expect(store.tokens?.refreshToken).toBe(original);
    expect(store.tokens?.refreshExpiresAt).toBe(readJwtExpiry(original ?? ''));
  });

  it('adopts a rotated refresh token', async () => {
    fake.rotateRefreshToken = true;
    await auth.login(USERNAME, PASSWORD);
    const original = store.tokens?.refreshToken;
    expireAccessToken();

    await auth.getAccessToken();

    expect(store.tokens?.refreshToken).toBe(fake.refreshToken);
    expect(store.tokens?.refreshToken).not.toBe(original);
  });

  it('ends the session when the server rejects the refresh token', async () => {
    await auth.login(USERNAME, PASSWORD);
    fake.refreshToken = makeJwt(now, 'revoked-server-side');
    expireAccessToken();

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(auth.isLoggedIn).toBe(false);
    expect(store.tokens).toBeNull();
  });

  it('keeps the session when the server is merely unreachable', async () => {
    await auth.login(USERNAME, PASSWORD);
    expireAccessToken();
    fake.server.use(http.post(`${BASE_URL}/api/token`, () => HttpResponse.error()));

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NetworkError);
    expect(auth.isLoggedIn).toBe(true);
    expect(store.tokens).not.toBeNull();
  });

  it('keeps the session on a server error', async () => {
    await auth.login(USERNAME, PASSWORD);
    expireAccessToken();
    fake.server.use(
      http.post(`${BASE_URL}/api/token`, () => HttpResponse.json({}, { status: 503 })),
    );

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(RommApiError);
    expect(auth.isLoggedIn).toBe(true);
  });
});

describe('readJwtExpiry', () => {
  it('reads the exp claim in milliseconds', () => {
    expect(readJwtExpiry(makeJwt(START))).toBe(START);
  });

  it('returns null for anything that is not a JWT with exp', () => {
    expect(readJwtExpiry('opaque-token')).toBeNull();
    expect(readJwtExpiry('a.!!!.c')).toBeNull();
    expect(readJwtExpiry(`a.${Buffer.from('{"sub":"x"}').toString('base64url')}.c`)).toBeNull();
  });
});
