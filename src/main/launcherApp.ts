import { join } from 'node:path';
import type {
  AuthStatus,
  LoginRequest,
  PlatformSummary,
  ProbeFinding,
  RomAssets,
  RomPage,
  RomQuery,
  RomSummary,
  ServerInfo,
} from '../shared/ipc';
import { AuthSession } from './romm/auth';
import { createAuthenticatedFetch } from './romm/authenticatedFetch';
import { RommClient, normalizeServerUrl, probeServer, type SimpleRom } from './romm/client';
import { CredentialStore, type Encryptor } from './romm/credentials';
import { NotAuthenticatedError } from './romm/errors';
import { runApiProbe } from './romm/probe';
import { SettingsStore } from './settings/store';

interface Connection {
  auth: AuthSession;
  client: RommClient;
}

export interface LauncherAppOptions {
  dataDir: string;
  hostname: string;
  encryptor: Encryptor;
}

/** Owns the main-process services and implements what the IPC layer exposes. */
export class LauncherApp {
  private readonly settings: SettingsStore;
  private readonly credentials: CredentialStore;
  private connection: Connection | null = null;

  constructor(options: LauncherAppOptions) {
    this.settings = new SettingsStore(join(options.dataDir, 'settings.json'), options.hostname);
    this.credentials = new CredentialStore(
      join(options.dataDir, 'credentials.bin'),
      options.encryptor,
    );

    const { serverUrl } = this.settings.get();
    if (serverUrl) this.connection = this.connect(serverUrl);
  }

  probeServer(serverUrl: string): Promise<ServerInfo> {
    return probeServer(normalizeServerUrl(serverUrl));
  }

  status(): AuthStatus {
    const { serverUrl, username } = this.settings.get();
    const loggedIn = this.connection?.auth.isLoggedIn ?? false;
    return {
      serverUrl,
      username: loggedIn ? username : null,
      loggedIn,
      credentialsPersisted: this.credentials.canPersist,
    };
  }

  async login(request: LoginRequest): Promise<AuthStatus> {
    const serverUrl = normalizeServerUrl(request.serverUrl);
    const connection = this.connect(serverUrl);
    await connection.auth.login(request.username, request.password);

    // Ask the server who we are instead of trusting what was typed (it may be an email).
    const user = await connection.client.getCurrentUser();
    this.connection = connection;
    this.settings.update({ serverUrl, username: user.username });
    return this.status();
  }

  logout(): AuthStatus {
    this.connection?.auth.logout();
    this.settings.update({ username: null });
    return this.status();
  }

  async listPlatforms(): Promise<PlatformSummary[]> {
    const platforms = await this.requireConnection().client.listPlatforms();
    return platforms
      .filter((platform) => platform.rom_count > 0)
      .map((platform) => ({
        id: platform.id,
        slug: platform.slug,
        fsSlug: platform.fs_slug,
        name: platform.display_name,
        romCount: platform.rom_count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRoms(query: RomQuery): Promise<RomPage> {
    const page = await this.requireConnection().client.listRoms(query);
    return {
      items: page.items.map(toRomSummary),
      total: page.total ?? page.items.length,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async getRomAssets(romId: number): Promise<RomAssets> {
    const { client } = this.requireConnection();
    const [saves, states] = await Promise.all([client.listSaves(romId), client.listStates(romId)]);
    return { saves, states };
  }

  runApiProbe(): Promise<ProbeFinding[]> {
    const { client, auth } = this.requireConnection();
    return runApiProbe(client, auth);
  }

  private connect(serverUrl: string): Connection {
    const auth = new AuthSession(serverUrl, this.credentials.forServer(serverUrl));
    return { auth, client: new RommClient(serverUrl, createAuthenticatedFetch(auth)) };
  }

  private requireConnection(): Connection {
    if (!this.connection?.auth.isLoggedIn) throw new NotAuthenticatedError();
    return this.connection;
  }
}

function toRomSummary(rom: SimpleRom): RomSummary {
  return {
    id: rom.id,
    name: rom.name ?? rom.fs_name_no_ext,
    fileName: rom.fs_name,
    sizeBytes: rom.fs_size_bytes,
    platformSlug: rom.platform_slug,
    coverPath: rom.path_cover_small,
    lastPlayed: rom.rom_user.last_played,
    hasMultipleFiles: rom.has_multiple_files,
    md5: rom.md5_hash,
  };
}
