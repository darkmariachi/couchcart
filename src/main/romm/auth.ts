import {
  NetworkError,
  NotAuthenticatedError,
  RommApiError,
  SessionExpiredError,
  describeErrorBody,
} from './errors';
import type { components } from './schema';

type TokenResponse = components['schemas']['TokenResponse'];

export interface TokenSet {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
}

export interface TokenStore {
  load(): TokenSet | null;
  save(tokens: TokenSet): void;
  clear(): void;
}

// Only what the launcher needs: browse the library, read/write saves and states,
// register this PC as a device, read firmware (BIOS) and update play status.
export const REQUESTED_SCOPES = [
  'me.read',
  'roms.read',
  'platforms.read',
  'assets.read',
  'assets.write',
  'devices.read',
  'devices.write',
  'firmware.read',
  'roms.user.read',
  'roms.user.write',
] as const;

/** Refresh slightly early so a request never leaves with a token about to expire. */
const EXPIRY_MARGIN_MS = 30_000;

export interface AuthDeps {
  fetch: typeof fetch;
  now: () => number;
}

export class AuthSession {
  private tokens: TokenSet | null;
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly store: TokenStore,
    private readonly deps: AuthDeps = { fetch: globalThis.fetch, now: Date.now },
  ) {
    this.tokens = store.load();
  }

  get isLoggedIn(): boolean {
    return this.tokens !== null;
  }

  /** Remaining lifetimes in seconds, for diagnostics only. */
  describeLifetimes(): { accessSeconds: number; refreshSeconds: number | null } | null {
    if (!this.tokens) return null;
    const now = this.deps.now();
    const { accessExpiresAt, refreshExpiresAt } = this.tokens;
    return {
      accessSeconds: Math.round((accessExpiresAt - now) / 1000),
      refreshSeconds:
        refreshExpiresAt === null ? null : Math.round((refreshExpiresAt - now) / 1000),
    };
  }

  async login(username: string, password: string): Promise<void> {
    const response = await this.requestToken({
      grant_type: 'password',
      username,
      password,
      scope: REQUESTED_SCOPES.join(' '),
    });
    if (!response.ok) {
      throw new RommApiError(response.status, await readError(response, 'Login failed.'));
    }
    this.setTokens(this.toTokenSet((await response.json()) as TokenResponse, null));
  }

  logout(): void {
    this.tokens = null;
    this.store.clear();
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new NotAuthenticatedError();
    if (this.tokens.accessExpiresAt - EXPIRY_MARGIN_MS > this.deps.now()) {
      return this.tokens.accessToken;
    }
    return this.refresh(this.tokens.accessToken);
  }

  /**
   * Exchanges the refresh token for a new access token. `staleAccessToken` is the token
   * the caller saw rejected: if another caller already replaced it, the current one is
   * returned without a second round trip.
   */
  async refresh(staleAccessToken: string): Promise<string> {
    if (!this.tokens) throw new NotAuthenticatedError();
    if (this.tokens.accessToken !== staleAccessToken) return this.tokens.accessToken;

    this.refreshInFlight ??= this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<string> {
    const previous = this.tokens;
    if (!previous?.refreshToken) {
      this.logout();
      throw new SessionExpiredError();
    }

    const response = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: previous.refreshToken,
    });
    if (response.status >= 400 && response.status < 500) {
      // The server rejected the refresh token itself; only a new login can recover.
      this.logout();
      throw new SessionExpiredError();
    }
    if (!response.ok) {
      throw new RommApiError(response.status, await readError(response, 'Token refresh failed.'));
    }

    const tokens = this.toTokenSet((await response.json()) as TokenResponse, previous);
    this.setTokens(tokens);
    return tokens.accessToken;
  }

  private async requestToken(form: Record<string, string>): Promise<Response> {
    try {
      return await this.deps.fetch(`${this.baseUrl}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
    } catch (cause) {
      throw new NetworkError('Could not reach the RomM server.', { cause });
    }
  }

  private setTokens(tokens: TokenSet): void {
    this.tokens = tokens;
    this.store.save(tokens);
  }

  private toTokenSet(response: TokenResponse, previous: TokenSet | null): TokenSet {
    const now = this.deps.now();
    // A refresh response may omit the refresh token, in which case the old one stays valid.
    const refreshToken = response.refresh_token ?? previous?.refreshToken ?? null;
    const refreshExpiresAt = response.refresh_token
      ? (readJwtExpiry(response.refresh_token) ??
        (response.refresh_expires ? now + response.refresh_expires * 1000 : null))
      : (previous?.refreshExpiresAt ?? null);

    return {
      accessToken: response.access_token,
      accessExpiresAt: readJwtExpiry(response.access_token) ?? now + response.expires * 1000,
      refreshToken,
      refreshExpiresAt,
    };
  }
}

/**
 * RomM's tokens are JWTs, so their `exp` claim is the authoritative expiry. The token is
 * only decoded, never trusted: the server still validates it on every request.
 */
export function readJwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims === 'object' && claims !== null && 'exp' in claims) {
      return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
    }
  } catch {
    // Not a JWT; the caller falls back to the lifetime reported by the server.
  }
  return null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    return describeErrorBody(await response.json(), fallback);
  } catch {
    return fallback;
  }
}
