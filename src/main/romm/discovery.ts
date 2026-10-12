import type { NetworkInterfaceInfo } from 'node:os';
import type { DiscoveredServer } from '../../shared/ipc';

/** The port RomM's container listens on unless someone changed it. */
export const DEFAULT_ROMM_PORT = 8080;

export interface DiscoveryOptions {
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
  fetch?: typeof fetch;
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
}

function isPrivate(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Addresses worth asking: this PC, and the 254 neighbours of each private IPv4 address it
 * has. Only home-sized ranges are covered on purpose; sweeping a larger network would be
 * slow and is not something an app should do uninvited.
 */
export function candidateHosts(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const hosts = new Set<string>(['127.0.0.1']);
  for (const addresses of Object.values(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal || !isPrivate(info.address)) continue;
      const prefix = info.address.split('.').slice(0, 3).join('.');
      for (let last = 1; last <= 254; last++) hosts.add(`${prefix}.${last}`);
    }
  }
  return [...hosts];
}

/**
 * Looks for RomM servers on the local network by asking each nearby address, on RomM's
 * default port, for the status page every RomM server has. It only finds servers on that
 * port that are reachable over plain HTTP; anything behind a reverse proxy or a custom
 * port has to be typed in.
 */
export async function discoverServers(options: DiscoveryOptions): Promise<DiscoveredServer[]> {
  const {
    fetch: fetchImpl = globalThis.fetch,
    port = DEFAULT_ROMM_PORT,
    timeoutMs = 900,
    concurrency = 64,
  } = options;

  const probe = async (host: string): Promise<DiscoveredServer | null> => {
    const url = `http://${host}:${port}`;
    try {
      const response = await fetchImpl(`${url}/api/heartbeat`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      // Something else may be listening on this port; only RomM answers in this shape.
      const version = (body as { SYSTEM?: { VERSION?: unknown } } | null)?.SYSTEM?.VERSION;
      return typeof version === 'string' ? { url, version } : null;
    } catch {
      return null;
    }
  };

  const queue = candidateHosts(options.interfaces);
  const found: DiscoveredServer[] = [];
  const worker = async () => {
    for (let host = queue.shift(); host !== undefined; host = queue.shift()) {
      const server = await probe(host);
      if (server) found.push(server);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return found.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
}
