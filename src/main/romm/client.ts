import createClient, { type Client } from 'openapi-fetch';
import { NetworkError, RommApiError, describeErrorBody } from './errors';
import { paginate } from './pagination';
import type { components, paths } from './schema';

type Schemas = components['schemas'];
export type Platform = Schemas['PlatformSchema'];
export type SimpleRom = Schemas['SimpleRomSchema'];
export type DetailedRom = Schemas['DetailedRomSchema'];
export type Save = Schemas['SaveSchema'];
export type State = Schemas['StateSchema'];
export type User = Schemas['UserSchema'];

export interface RomListQuery {
  platformId?: number;
  search?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface RomListPage {
  items: SimpleRom[];
  total: number | null;
}

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function unwrap<T>({ data, error, response }: ApiResult<T>): T {
  if (error !== undefined || data === undefined) {
    throw new RommApiError(
      response.status,
      describeErrorBody(error, `RomM returned HTTP ${response.status}.`),
    );
  }
  return data;
}

export function normalizeServerUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('The RomM URL must start with http:// or https://');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** Unauthenticated reachability check; also tells us which RomM version we talk to. */
export async function probeServer(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ version: string }> {
  const api = createClient<paths>({ baseUrl, fetch: (request) => fetchImpl(request) });
  let result;
  try {
    result = await api.GET('/api/heartbeat');
  } catch (cause) {
    throw new NetworkError('Could not reach the RomM server.', { cause });
  }
  return { version: unwrap(result).SYSTEM.VERSION };
}

export class RommClient {
  private readonly api: Client<paths>;

  constructor(
    readonly baseUrl: string,
    private readonly authenticatedFetch: (request: Request) => Promise<Response>,
  ) {
    this.api = createClient<paths>({ baseUrl, fetch: authenticatedFetch });
  }

  async getCurrentUser(): Promise<User> {
    const user = unwrap(await this.api.GET('/api/users/me'));
    if (!user) throw new RommApiError(401, 'RomM did not return a user for this session.');
    return user;
  }

  async listPlatforms(): Promise<Platform[]> {
    return unwrap(await this.api.GET('/api/platforms'));
  }

  async listRoms(query: RomListQuery = {}): Promise<RomListPage> {
    const page = unwrap(
      await this.api.GET('/api/roms', {
        params: {
          query: {
            platform_ids: query.platformId === undefined ? undefined : [query.platformId],
            search_term: query.search || undefined,
            order_by: query.orderBy ?? 'name',
            order_dir: query.orderDir ?? 'asc',
            offset: query.offset ?? 0,
            limit: query.limit ?? 50,
            // These exist for RomM's own web UI and are expensive on large libraries.
            with_char_index: false,
            with_filter_values: false,
            with_rom_id_index: false,
          },
        },
      }),
    );
    return { items: page.items, total: page.total };
  }

  iterateRoms(query: Omit<RomListQuery, 'offset' | 'limit'> = {}): AsyncGenerator<SimpleRom> {
    return paginate((offset, limit) => this.listRoms({ ...query, offset, limit }));
  }

  async getRom(id: number): Promise<DetailedRom> {
    return unwrap(await this.api.GET('/api/roms/{id}', { params: { path: { id } } }));
  }

  /** All of the current user's saves, optionally limited to one ROM. */
  async listSaves(romId?: number): Promise<Save[]> {
    return unwrap(await this.api.GET('/api/saves', { params: { query: { rom_id: romId } } }));
  }

  async listStates(romId?: number): Promise<State[]> {
    return unwrap(await this.api.GET('/api/states', { params: { query: { rom_id: romId } } }));
  }

  /** Authenticated request for endpoints that return file content rather than JSON. */
  fetchRaw(pathAndQuery: string, init?: RequestInit): Promise<Response> {
    return this.authenticatedFetch(new Request(`${this.baseUrl}${pathAndQuery}`, init));
  }
}
