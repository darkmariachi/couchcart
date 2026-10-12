import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LauncherApp } from '../src/main/launcherApp';
import { AuthSession } from '../src/main/romm/auth';
import { createAuthenticatedFetch } from '../src/main/romm/authenticatedFetch';
import { RommClient } from '../src/main/romm/client';
import { NetworkError, SessionExpiredError } from '../src/main/romm/errors';
import { pollPairing, startPairing, type PairingDevice } from '../src/main/romm/pairing';
import { BASE_URL, MemoryTokenStore, createFakeRomm, type FakeRomm } from './helpers/fakeRomm';

const device: PairingDevice = {
  identifier: 'install-1',
  name: 'LIVINGROOM-PC',
  client: 'couchcart',
  platform: 'win32',
  clientVersion: '0.1.0',
  scopes: ['roms.read', 'assets.write'],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('startPairing', () => {
  it('asks for a code and builds the pages to open from the server address', async () => {
    const fetch = vi.fn(async () =>
      json(
        {
          device_code: 'secret-device-code',
          user_code: 'V35K6U67',
          verification_path: '/pair/device',
          verification_path_complete: '/pair/device?user_code=V35K6U67',
          expires_in: 600,
          interval: 5,
        },
        201,
      ),
    );

    const pairing = await startPairing(BASE_URL, device, fetch, () => 1_000_000);

    expect(pairing).toEqual({
      deviceCode: 'secret-device-code',
      userCode: 'V35K6U67',
      verificationUrl: `${BASE_URL}/pair/device`,
      completeUrl: `${BASE_URL}/pair/device?user_code=V35K6U67`,
      expiresAt: 1_600_000,
      intervalSeconds: 5,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/auth/device/init`);
    expect(JSON.parse(String(init.body))).toEqual({
      client_device_identifier: 'install-1',
      name: 'LIVINGROOM-PC',
      client: 'couchcart',
      platform: 'win32',
      client_version: '0.1.0',
      requested_scopes: ['roms.read', 'assets.write'],
    });
  });

  it('explains when the server is too old to pair', async () => {
    const fetch = async () => json({ detail: 'Not Found' }, 404);

    await expect(startPairing(BASE_URL, device, fetch)).rejects.toMatchObject({ status: 404 });
  });

  it('reports an unreachable server as a network problem', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(startPairing(BASE_URL, device, fetch)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('pollPairing', () => {
  const poll = (body: unknown, status: number) =>
    pollPairing(BASE_URL, 'secret-device-code', async () => json(body, status));

  it('keeps waiting while the user has not approved yet', async () => {
    expect(await poll({ detail: 'authorization_pending' }, 400)).toEqual({ status: 'pending' });
    expect(await poll({ detail: 'slow_down' }, 400)).toEqual({ status: 'pending' });
  });

  it('returns the token once approved', async () => {
    const result = await poll(
      { access_token: 'rmm_token', device_id: 'device-9', scopes: [], expires_at: null },
      200,
    );

    expect(result).toEqual({
      status: 'approved',
      token: { accessToken: 'rmm_token', deviceId: 'device-9', expiresAt: null },
    });
  });

  it('reads an expiry date when the token has one', async () => {
    const result = await poll(
      {
        access_token: 't',
        device_id: 'd',
        scopes: [],
        expires_at: '2027-01-01T00:00:00+00:00',
      },
      200,
    );

    expect(result).toMatchObject({ token: { expiresAt: Date.UTC(2027, 0, 1) } });
  });

  it('distinguishes a denied request from an expired code', async () => {
    expect(await poll({ detail: 'access_denied' }, 400)).toEqual({ status: 'denied' });
    expect(await poll({ detail: 'expired_token' }, 400)).toEqual({ status: 'expired' });
  });

  it('fails on anything unexpected rather than waiting forever', async () => {
    await expect(poll({ detail: 'Internal Server Error' }, 500)).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('a paired session', () => {
  let fake: FakeRomm;
  beforeAll(() => {
    fake = createFakeRomm();
    fake.server.listen({ onUnhandledRequest: 'error' });
  });
  afterAll(() => fake.server.close());
  afterEach(() => fake.server.resetHandlers());
  beforeEach(() => {
    fake.tokenRequests.length = 0;
    fake.validAccessTokens.clear();
  });

  it('is used as it is, without any refresh', async () => {
    fake.validAccessTokens.add('paired-token');
    const store = new MemoryTokenStore();
    const auth = new AuthSession(BASE_URL, store);
    auth.adoptToken('paired-token', null);
    const client = new RommClient(BASE_URL, createAuthenticatedFetch(auth));

    expect(await client.listPlatforms()).toHaveLength(1);
    expect(store.tokens).toMatchObject({ accessToken: 'paired-token', refreshToken: null });
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('ends cleanly when the server revokes the token', async () => {
    const store = new MemoryTokenStore();
    const auth = new AuthSession(BASE_URL, store);
    auth.adoptToken('revoked-token', null);
    const client = new RommClient(BASE_URL, createAuthenticatedFetch(auth));

    await expect(client.listPlatforms()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(auth.isLoggedIn).toBe(false);
    expect(store.tokens).toBeNull();
    expect(fake.tokenRequests).toHaveLength(0); // there is no refresh token to try
  });
});

describe('pairing in the app', () => {
  let fake: FakeRomm;
  let dir: string;
  let app: LauncherApp;
  let approved: boolean;

  beforeAll(() => {
    fake = createFakeRomm();
    fake.server.listen({ onUnhandledRequest: 'error' });
  });
  afterAll(() => fake.server.close());

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'couchcart-pairing-'));
    approved = false;
    fake.validAccessTokens.clear();
    fake.server.use(
      http.post(`${BASE_URL}/api/auth/device/init`, () =>
        HttpResponse.json(
          {
            device_code: 'secret-device-code',
            user_code: 'ABCD1234',
            verification_path: '/pair/device',
            verification_path_complete: '/pair/device?user_code=ABCD1234',
            expires_in: 600,
            interval: 5,
          },
          { status: 201 },
        ),
      ),
      http.post(`${BASE_URL}/api/auth/device/token`, () => {
        if (!approved) {
          return HttpResponse.json({ detail: 'authorization_pending' }, { status: 400 });
        }
        fake.validAccessTokens.add('paired-token');
        return HttpResponse.json({
          access_token: 'paired-token',
          device_id: 'device-9',
          scopes: [],
          expires_at: null,
        });
      }),
    );
    app = new LauncherApp({
      dataDir: dir,
      hostname: 'TEST-PC',
      appVersion: '0.0.0',
      encryptor: {
        isAvailable: () => true,
        encrypt: (text) => Buffer.from(text, 'utf8'),
        decrypt: (data) => data.toString('utf8'),
      },
      onLaunchStateChanged: () => {},
      onDownloadsChanged: () => {},
      onOnlineChanged: () => {},
      shell: {
        choosePath: async () => null,
        quit: () => {},
        toggleFullscreen: () => {},
        copyText: () => {},
        openFolder: () => {},
        openExternal: () => {},
      },
    });
  });
  afterEach(() => {
    fake.server.resetHandlers();
    app.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('shows the code without ever exposing the device secret, then signs in on approval', async () => {
    const info = await app.startPairing(BASE_URL);

    expect(info).toMatchObject({
      userCode: 'ABCD1234',
      verificationUrl: `${BASE_URL}/pair/device`,
      completeUrl: `${BASE_URL}/pair/device?user_code=ABCD1234`,
      intervalSeconds: 5,
    });
    expect(JSON.stringify(info)).not.toContain('secret-device-code');
    expect(await app.checkPairing()).toEqual({ state: 'pending' });
    expect(app.status().loggedIn).toBe(false);

    approved = true;
    const status = await app.checkPairing();

    expect(status).toMatchObject({
      state: 'approved',
      auth: { loggedIn: true, username: 'player', serverUrl: BASE_URL },
    });
    expect(await app.listPlatforms()).toHaveLength(1);
    expect(await app.checkPairing()).toEqual({ state: 'none' });
  });

  it('reports nothing in progress before pairing starts or after it is cancelled', async () => {
    expect(await app.checkPairing()).toEqual({ state: 'none' });

    await app.startPairing(BASE_URL);
    app.cancelPairing();

    expect(await app.checkPairing()).toEqual({ state: 'none' });
  });
});
