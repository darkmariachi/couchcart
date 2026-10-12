import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { candidateHosts, discoverServers } from '../src/main/romm/discovery';

const ipv4 = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;

const home = {
  Ethernet: [ipv4('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false }],
  Loopback: [ipv4('127.0.0.1', true)],
} as NodeJS.Dict<NetworkInterfaceInfo[]>;

/** A network where the given `host:port` pairs answer like RomM and the rest time out. */
function network(servers: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const body = servers[url.host];
    if (body === undefined) throw new Error('connect ETIMEDOUT');
    return new Response(JSON.stringify(body));
  });
}

describe('candidateHosts', () => {
  it('covers this PC and the neighbours of each private address', () => {
    const hosts = candidateHosts(home);

    expect(hosts).toHaveLength(255);
    expect(hosts).toContain('127.0.0.1');
    expect(hosts).toContain('192.168.1.1');
    expect(hosts).toContain('192.168.1.254');
    expect(hosts).not.toContain('192.168.1.0');
    expect(hosts).not.toContain('192.168.1.255');
  });

  it('does not sweep public networks', () => {
    const hosts = candidateHosts({ Wan: [ipv4('203.0.113.7')], Vpn: [ipv4('172.32.0.5')] });

    expect(hosts).toEqual(['127.0.0.1']);
  });

  it('covers every private network the PC is on, once', () => {
    const hosts = candidateHosts({
      Ethernet: [ipv4('192.168.1.20')],
      WiFi: [ipv4('192.168.1.21')],
      Docker: [ipv4('172.17.0.1')],
      Vpn: [ipv4('10.8.0.2')],
    });

    expect(hosts).toHaveLength(1 + 254 * 3);
  });
});

describe('discoverServers', () => {
  it('finds RomM on its default port and reports its version', async () => {
    const fetch = network({ '192.168.1.50:8080': { SYSTEM: { VERSION: '5.4.0' } } });

    const servers = await discoverServers({ interfaces: home, fetch });

    expect(servers).toEqual([{ url: 'http://192.168.1.50:8080', version: '5.4.0' }]);
    expect(fetch).toHaveBeenCalledTimes(255);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/:8080\/api\/heartbeat$/);
  });

  it('ignores other things that happen to listen on that port', async () => {
    const fetch = network({
      '192.168.1.2:8080': { status: 'ok' },
      '192.168.1.3:8080': 'not json at all',
      '192.168.1.4:8080': { SYSTEM: { VERSION: 5 } },
    });

    expect(await discoverServers({ interfaces: home, fetch })).toEqual([]);
  });

  it('lists several servers in address order', async () => {
    const romm = { SYSTEM: { VERSION: '5.4.0' } };
    const fetch = network({
      '192.168.1.100:8080': romm,
      '192.168.1.9:8080': romm,
      '127.0.0.1:8080': romm,
    });

    const servers = await discoverServers({ interfaces: home, fetch });

    expect(servers.map((server) => server.url)).toEqual([
      'http://127.0.0.1:8080',
      'http://192.168.1.9:8080',
      'http://192.168.1.100:8080',
    ]);
  });

  it('returns nothing, without failing, when no server answers', async () => {
    expect(await discoverServers({ interfaces: home, fetch: network({}) })).toEqual([]);
  });

  it('can look on another port', async () => {
    const fetch = network({ '192.168.1.50:3000': { SYSTEM: { VERSION: '5.4.0' } } });

    const servers = await discoverServers({ interfaces: home, fetch, port: 3000 });

    expect(servers).toEqual([{ url: 'http://192.168.1.50:3000', version: '5.4.0' }]);
  });
});
