import type { AuthSession } from './auth';
import { NetworkError } from './errors';

export interface RetryOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
}

const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/**
 * Wraps fetch with what every RomM call needs: a bearer token, one transparent retry
 * after a 401 (with a refreshed token), and backoff retries for transient failures.
 * Only GET/HEAD are retried on transient failures, since replaying an upload that may
 * have partly succeeded is the caller's decision.
 */
export function createAuthenticatedFetch(
  auth: AuthSession,
  options: RetryOptions = {},
): (request: Request) => Promise<Response> {
  const {
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxAttempts = 3,
    baseDelayMs = 300,
  } = options;

  return async (request) => {
    const idempotent = request.method === 'GET' || request.method === 'HEAD';
    const attempts = idempotent ? maxAttempts : 1;
    let refreshedAfter401 = false;

    for (let attempt = 1; ; attempt++) {
      const token = await auth.getAccessToken();
      const outgoing = request.clone();
      outgoing.headers.set('Authorization', `Bearer ${token}`);

      let response: Response;
      try {
        response = await fetchImpl(outgoing);
      } catch (cause) {
        if (request.signal.aborted) throw cause; // cancelled by the caller, not a failure
        if (attempt >= attempts) {
          throw new NetworkError('Could not reach the RomM server.', { cause });
        }
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }

      if (response.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        discardBody(response);
        await auth.refresh(token);
        attempt--; // the refresh round trip does not count against the retry budget
        continue;
      }

      if (TRANSIENT_STATUSES.has(response.status) && attempt < attempts) {
        discardBody(response);
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }

      return response;
    }
  };
}

// Releases the connection without waiting on it: a retry must not hang on a body that
// never finishes cancelling.
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return exponential + Math.random() * exponential * 0.25;
}
