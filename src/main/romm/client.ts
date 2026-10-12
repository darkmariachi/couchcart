import createClient, { type Client } from 'openapi-fetch';
import { APP_ID } from '../../shared/app';
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
export type Collection = Schemas['CollectionSchema'];
export type Device = Schemas['DeviceSchema'];
export type SmartCollection = Schemas['SmartCollectionSchema'];
export type VirtualCollection = Schemas['VirtualCollectionSchema'];

export interface RomListQuery {
  platformId?: number;
  search?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** Only games the current user has played. */
  playedOnly?: boolean;
  collectionId?: number;
  smartCollectionId?: number;
  virtualCollectionId?: string;
  offset?: number;
  limit?: number;
}

export interface RomListPage {
  items: SimpleRom[];
  total: number | null;
}

export interface FileUpload {
  fileName: string;
  content: Buffer;
}

export interface SaveUpload extends FileUpload {
  romId: number;
  slot: string;
  emulator: string | null;
  deviceId: string | null;
  contentHash: string;
  overwrite?: boolean;
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
            last_played: query.playedOnly ? true : undefined,
            collection_id: query.collectionId,
            smart_collection_id: query.smartCollectionId,
            virtual_collection_id: query.virtualCollectionId,
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

  async listCollections(): Promise<Collection[]> {
    return unwrap(await this.api.GET('/api/collections'));
  }

  async listSmartCollections(): Promise<SmartCollection[]> {
    return unwrap(await this.api.GET('/api/collections/smart'));
  }

  /** Collections RomM derives from metadata; `type` is e.g. "collection" or "franchise". */
  async listVirtualCollections(type: string): Promise<VirtualCollection[]> {
    return unwrap(await this.api.GET('/api/collections/virtual', { params: { query: { type } } }));
  }

  async addToCollection(collectionId: number, romIds: number[]): Promise<void> {
    unwrap(
      await this.api.POST('/api/collections/{id}/roms', {
        params: { path: { id: collectionId } },
        body: { rom_ids: romIds },
      }),
    );
  }

  async removeFromCollection(collectionId: number, romIds: number[]): Promise<void> {
    unwrap(
      await this.api.DELETE('/api/collections/{id}/roms', {
        params: { path: { id: collectionId } },
        body: { rom_ids: romIds },
      }),
    );
  }

  /** Creates the user's favourites collection, the way RomM's own UI does on first use. */
  async createFavoritesCollection(): Promise<Collection> {
    const form = new FormData();
    form.append('name', 'Favourites');
    form.append('description', '');
    const response = await this.fetchRaw('/api/collections?is_favorite=true&is_public=false', {
      method: 'POST',
      body: form,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new RommApiError(
        response.status,
        describeErrorBody(body, `RomM returned HTTP ${response.status}.`),
      );
    }
    return body as Collection;
  }

  async listDevices(): Promise<Device[]> {
    return unwrap(await this.api.GET('/api/devices'));
  }

  /** Library totals. This endpoint needs no particular permission. */
  async getStats(): Promise<Schemas['StatsReturn']> {
    return unwrap(await this.api.GET('/api/stats'));
  }

  /** Records "last played: now" for the current user. */
  async markPlayed(romId: number): Promise<void> {
    unwrap(
      await this.api.PUT('/api/roms/{id}/props', {
        params: { path: { id: romId }, query: { update_last_played: true } },
        body: {},
      }),
    );
  }

  /** Fetches a server-relative asset path such as a cover image. */
  fetchAsset(path: string): Promise<Response> {
    return this.fetchRaw(path);
  }

  /** Registers this PC with RomM (or finds its existing registration) and returns its id. */
  async registerDevice(device: {
    name: string;
    hostname: string;
    platform: string;
    clientVersion: string;
  }): Promise<string> {
    const created = unwrap(
      await this.api.POST('/api/devices', {
        body: {
          name: device.name,
          hostname: device.hostname,
          platform: device.platform,
          client: APP_ID,
          client_version: device.clientVersion,
          // Reuse this PC's existing registration instead of creating a duplicate.
          allow_existing: true,
          allow_duplicate: false,
          reset_syncs: false,
        },
      }),
    );
    return created.device_id;
  }

  /**
   * Uploads a save as a new version in its slot. RomM answers 409 when the slot changed on
   * the server since this device last synced it, unless `overwrite` is set.
   */
  async uploadSave(upload: SaveUpload): Promise<Save> {
    const query = new URLSearchParams({ rom_id: String(upload.romId), slot: upload.slot });
    if (upload.emulator) query.set('emulator', upload.emulator);
    if (upload.deviceId) query.set('device_id', upload.deviceId);
    query.set('content_hash', upload.contentHash);
    if (upload.overwrite) query.set('overwrite', 'true');

    return this.sendFile<Save>('POST', `/api/saves?${query}`, 'saveFile', upload);
  }

  async downloadSave(id: number, deviceId: string | null): Promise<Buffer> {
    const query = deviceId ? `?${new URLSearchParams({ device_id: deviceId })}` : '';
    return this.downloadFile(`/api/saves/${id}/content${query}`);
  }

  /** Tells RomM this device now holds the given save version. */
  async confirmSaveDownloaded(id: number, deviceId: string, contentHash: string): Promise<void> {
    unwrap(
      await this.api.POST('/api/saves/{id}/downloaded', {
        params: { path: { id } },
        body: { device_id: deviceId, content_hash: contentHash },
      }),
    );
  }

  async uploadState(
    upload: FileUpload & { romId: number; emulator: string | null },
  ): Promise<State> {
    const query = new URLSearchParams({ rom_id: String(upload.romId) });
    if (upload.emulator) query.set('emulator', upload.emulator);
    return this.sendFile<State>('POST', `/api/states?${query}`, 'stateFile', upload);
  }

  async replaceState(id: number, upload: FileUpload): Promise<State> {
    return this.sendFile<State>('PUT', `/api/states/${id}`, 'stateFile', upload);
  }

  async downloadState(id: number): Promise<Buffer> {
    return this.downloadFile(`/api/states/${id}/content`);
  }

  private async sendFile<T>(
    method: 'POST' | 'PUT',
    pathAndQuery: string,
    field: string,
    file: FileUpload,
  ): Promise<T> {
    const form = new FormData();
    form.append(field, new Blob([new Uint8Array(file.content)]), file.fileName);
    const response = await this.fetchRaw(pathAndQuery, { method, body: form });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new RommApiError(
        response.status,
        describeErrorBody(body, `RomM returned HTTP ${response.status}.`),
      );
    }
    return body as T;
  }

  private async downloadFile(pathAndQuery: string): Promise<Buffer> {
    const response = await this.fetchRaw(pathAndQuery);
    if (!response.ok) {
      throw new RommApiError(response.status, `Download failed (HTTP ${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** Authenticated request for endpoints that return file content rather than JSON. */
  fetchRaw(pathAndQuery: string, init?: RequestInit): Promise<Response> {
    return this.authenticatedFetch(new Request(`${this.baseUrl}${pathAndQuery}`, init));
  }
}
