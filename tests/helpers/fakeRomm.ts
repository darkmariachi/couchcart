import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { TokenSet, TokenStore } from '../../src/main/romm/auth';
import type { Platform, SimpleRom } from '../../src/main/romm/client';

export const BASE_URL = 'https://romm.test';
export const USERNAME = 'player';
export const PASSWORD = 'correct-horse';

/** An unsigned JWT with just the claim the client reads. */
export function makeJwt(expiresAtMs: number, label = 'token'): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: Math.floor(expiresAtMs / 1000), label })}.sig`;
}

export class MemoryTokenStore implements TokenStore {
  constructor(public tokens: TokenSet | null = null) {}
  load = () => this.tokens;
  save = (tokens: TokenSet) => {
    this.tokens = tokens;
  };
  clear = () => {
    this.tokens = null;
  };
}

// Fixtures carry only the fields the launcher reads; the casts keep them short. Replace
// with recorded responses (tests/fixtures/recorded, git-ignored) when checking real data.
export function platformFixture(overrides: Partial<Platform> = {}): Platform {
  return {
    id: 4,
    slug: 'n64',
    fs_slug: 'n64',
    rom_count: 3,
    name: 'Nintendo 64',
    display_name: 'Nintendo 64',
    ...overrides,
  } as Platform;
}

export function romFixture(id: number, overrides: Partial<SimpleRom> = {}): SimpleRom {
  return {
    id,
    platform_id: 4,
    platform_slug: 'n64',
    name: `Game ${id}`,
    fs_name: `Game ${id}.z64`,
    fs_name_no_ext: `Game ${id}`,
    fs_size_bytes: 8 * 1024 * 1024,
    path_cover_small: `roms/4/${id}/cover/small.webp`,
    md5_hash: null,
    has_multiple_files: false,
    has_simple_single_file: true,
    rom_user: { last_played: null },
    ...overrides,
  } as SimpleRom;
}

export interface FakeRomm {
  server: ReturnType<typeof setupServer>;
  /** Form bodies of every POST /api/token, in order. */
  tokenRequests: URLSearchParams[];
  /** Every authenticated API request that reached the server. */
  apiRequests: Request[];
  /** Access tokens the fake currently accepts. */
  validAccessTokens: Set<string>;
  refreshToken: string;
  /** When false, refresh responses omit `refresh_token`, like real RomM may. */
  rotateRefreshToken: boolean;
  roms: SimpleRom[];
  now: () => number;
}

export function createFakeRomm(now: () => number = Date.now): FakeRomm {
  let issued = 0;
  const fake: Omit<FakeRomm, 'server'> = {
    tokenRequests: [],
    apiRequests: [],
    validAccessTokens: new Set(),
    refreshToken: makeJwt(now() + 7 * 86_400_000, 'refresh-0'),
    rotateRefreshToken: false,
    roms: [1, 2, 3].map((id) => romFixture(id)),
    now,
  };

  const issueAccessToken = () => {
    const token = makeJwt(fake.now() + 30 * 60_000, `access-${++issued}`);
    fake.validAccessTokens.add(token);
    return token;
  };

  const authorized = (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token !== undefined && fake.validAccessTokens.has(token);
  };

  const guarded =
    (respond: (request: Request) => Response) =>
    ({ request }: { request: Request }) => {
      if (!authorized(request)) {
        return HttpResponse.json({ detail: 'Invalid token' }, { status: 401 });
      }
      fake.apiRequests.push(request.clone());
      return respond(request);
    };

  // Registered as initial handlers so resetHandlers() drops only per-test overrides.
  const server = setupServer(
    http.post(`${BASE_URL}/api/token`, async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      fake.tokenRequests.push(form);

      if (form.get('grant_type') === 'password') {
        if (form.get('username') !== USERNAME || form.get('password') !== PASSWORD) {
          return HttpResponse.json({ detail: 'Invalid username or password' }, { status: 401 });
        }
        return HttpResponse.json({
          access_token: issueAccessToken(),
          token_type: 'bearer',
          expires: 1800,
          refresh_token: fake.refreshToken,
          refresh_expires: 604_800,
        });
      }

      if (form.get('refresh_token') !== fake.refreshToken) {
        return HttpResponse.json({ detail: 'Invalid refresh token' }, { status: 400 });
      }
      if (fake.rotateRefreshToken) {
        fake.refreshToken = makeJwt(fake.now() + 7 * 86_400_000, `refresh-${issued + 1}`);
      }
      return HttpResponse.json({
        access_token: issueAccessToken(),
        token_type: 'bearer',
        expires: 1800,
        ...(fake.rotateRefreshToken ? { refresh_token: fake.refreshToken } : {}),
      });
    }),

    http.get(`${BASE_URL}/api/heartbeat`, () =>
      HttpResponse.json({ SYSTEM: { VERSION: '5.4.0' } }),
    ),

    http.get(
      `${BASE_URL}/api/users/me`,
      guarded(() => HttpResponse.json({ id: 1, username: USERNAME })),
    ),

    http.get(
      `${BASE_URL}/api/platforms`,
      guarded(() => HttpResponse.json([platformFixture({ rom_count: fake.roms.length })])),
    ),

    http.get(
      `${BASE_URL}/api/roms`,
      guarded((request) => {
        const query = new URL(request.url).searchParams;
        const offset = Number(query.get('offset') ?? 0);
        const limit = Number(query.get('limit') ?? 50);
        return HttpResponse.json({
          items: fake.roms.slice(offset, offset + limit),
          total: fake.roms.length,
          offset,
          limit,
        });
      }),
    ),
  );

  return Object.assign(fake, { server });
}
