import { NetworkError, RommApiError, describeErrorBody } from './errors';
import type { components } from './schema';

type InitResponse = components['schemas']['DeviceAuthInitResponse'];
type TokenResponse = components['schemas']['DeviceAuthTokenResponse'];

export interface PairingDevice {
  /** Stable id of this install, so pairing again replaces the old pairing in RomM. */
  identifier: string;
  name: string;
  client: string;
  platform: string;
  clientVersion: string;
  scopes: readonly string[];
}

export interface PairingRequest {
  /** Secret that only this app holds; it is what gets exchanged for the token. */
  deviceCode: string;
  /** Short code the user types (or scans) on a device that is signed in to RomM. */
  userCode: string;
  /** Page of the RomM web UI where the code is entered. */
  verificationUrl: string;
  /** The same page with the code filled in, for a QR code. */
  completeUrl: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface PairedToken {
  accessToken: string;
  deviceId: string;
  /** Null when the token does not expire. */
  expiresAt: number | null;
}

export type PairingPoll =
  | { status: 'pending' }
  | { status: 'approved'; token: PairedToken }
  | { status: 'denied' }
  | { status: 'expired' };

async function post(
  fetchImpl: typeof fetch,
  url: string,
  body: object,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new NetworkError('Could not reach the RomM server.', { cause });
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * Starts pairing: RomM hands out a short code for the user to approve from a browser where
 * they are already signed in. No password is typed on this PC, which matters when the only
 * input is a controller. (This is the OAuth "device authorization" flow.)
 */
export async function startPairing(
  baseUrl: string,
  device: PairingDevice,
  fetchImpl: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<PairingRequest> {
  const { status, body } = await post(fetchImpl, `${baseUrl}/api/auth/device/init`, {
    client_device_identifier: device.identifier,
    name: device.name,
    client: device.client,
    platform: device.platform,
    client_version: device.clientVersion,
    requested_scopes: device.scopes,
  });
  if (status !== 201 && status !== 200) {
    // Older RomM versions have no pairing; they answer 404 or 405 here.
    const fallback =
      status === 404 || status === 405
        ? 'This RomM server does not support signing in with a code. Use a password instead.'
        : `RomM returned HTTP ${status}.`;
    throw new RommApiError(status, describeErrorBody(body, fallback));
  }

  const started = body as InitResponse;
  return {
    deviceCode: started.device_code,
    userCode: started.user_code,
    verificationUrl: `${baseUrl}${started.verification_path}`,
    completeUrl: `${baseUrl}${started.verification_path_complete}`,
    expiresAt: now() + started.expires_in * 1000,
    intervalSeconds: Math.max(1, started.interval),
  };
}

/** Asks whether the user has approved yet. Meant to be called every `intervalSeconds`. */
export async function pollPairing(
  baseUrl: string,
  deviceCode: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PairingPoll> {
  const { status, body } = await post(fetchImpl, `${baseUrl}/api/auth/device/token`, {
    device_code: deviceCode,
  });

  if (status === 200) {
    const granted = body as TokenResponse;
    return {
      status: 'approved',
      token: {
        accessToken: granted.access_token,
        deviceId: granted.device_id,
        expiresAt: granted.expires_at ? Date.parse(granted.expires_at) : null,
      },
    };
  }

  // RomM answers 400 with one of the standard device-flow codes as the detail.
  const detail = describeErrorBody(body, '');
  if (detail === 'authorization_pending' || detail === 'slow_down') return { status: 'pending' };
  if (detail === 'access_denied') return { status: 'denied' };
  if (detail === 'expired_token') return { status: 'expired' };
  throw new RommApiError(status, detail || `RomM returned HTTP ${status}.`);
}
