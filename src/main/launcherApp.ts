import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type {
  AuthStatus,
  ConflictResolution,
  SyncReport,
  LaunchState,
  LoginRequest,
  PlatformSummary,
  ProbeFinding,
  RomAssets,
  RomPage,
  RomQuery,
  RomSummary,
  RetroArchStatus,
  ServerInfo,
} from '../shared/ipc';
import { listInstalledCores } from './launcher/cores';
import { resolveCore, DEFAULT_CORES } from './launcher/cores';
import { LaunchService, emulatorName } from './launcher/launchService';
import { log } from './logging/logger';
import { SaveBackups } from './saves/backups';
import { SaveSyncService, type SyncableRom } from './saves/saveSyncService';
import { SyncStore } from './saves/syncStore';
import { locateRetroArch } from './launcher/retroarch';
import { DataPaths } from './paths';
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
  appVersion: string;
  encryptor: Encryptor;
  onLaunchStateChanged: (state: LaunchState) => void;
}

/** Owns the main-process services and implements what the IPC layer exposes. */
export class LauncherApp {
  private readonly settings: SettingsStore;
  private readonly credentials: CredentialStore;
  private readonly launcher: LaunchService;
  private readonly saveSync: SaveSyncService;
  private readonly syncStore: SyncStore;
  private connection: Connection | null = null;

  constructor(private readonly options: LauncherAppOptions) {
    this.settings = new SettingsStore(join(options.dataDir, 'settings.json'), options.hostname);
    this.credentials = new CredentialStore(
      join(options.dataDir, 'credentials.bin'),
      options.encryptor,
    );

    const paths = new DataPaths(options.dataDir, () => this.settings.get().cacheDir);
    this.syncStore = new SyncStore(join(options.dataDir, 'sync.db'));
    this.saveSync = new SaveSyncService({
      getRemote: () => this.requireConnection().client,
      store: this.syncStore,
      backups: new SaveBackups(
        join(options.dataDir, 'save-backups'),
        () => this.settings.get().saveBackupCount,
      ),
      paths,
      getDeviceId: () => this.ensureDeviceId(),
    });

    this.launcher = new LaunchService({
      getRomSource: () => this.requireConnection().client,
      getSettings: () => this.settings.get(),
      paths,
      syncSaves: (rom, emulator) => this.saveSync.syncRom(rom, emulator),
      locateRetroArch,
      listInstalledCores,
      spawn,
      onStateChanged: options.onLaunchStateChanged,
    });

    const { serverUrl, username } = this.settings.get();
    if (serverUrl) this.connection = this.connect(serverUrl);
    if (serverUrl && username) this.syncStore.bindAccount(accountKey(serverUrl, username));
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
    // A device id belongs to one account on one server.
    const previous = this.settings.get();
    const sameAccount = previous.serverUrl === serverUrl && previous.username === user.username;
    this.settings.update({
      serverUrl,
      username: user.username,
      deviceId: sameAccount ? previous.deviceId : null,
    });
    this.syncStore.bindAccount(accountKey(serverUrl, user.username));
    return this.status();
  }

  logout(): AuthStatus {
    this.connection?.auth.logout();
    this.settings.update({ username: null, deviceId: null });
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

  getRetroArchStatus(): Promise<RetroArchStatus> {
    return this.launcher.getRetroArchStatus();
  }

  async play(romId: number): Promise<undefined> {
    await this.launcher.play(romId);
  }

  getLaunchState(): LaunchState {
    return this.launcher.getState();
  }

  async syncSaves(romId: number): Promise<SyncReport> {
    const rom = await this.requireConnection().client.getRom(romId);
    return this.saveSync.syncRom(rom, await this.emulatorFor(rom));
  }

  getLastSyncReport(romId: number): SyncReport | null {
    return this.saveSync.getLastReport(romId);
  }

  async resolveConflict(resolution: ConflictResolution): Promise<SyncReport> {
    const rom = await this.requireConnection().client.getRom(resolution.romId);
    return this.saveSync.resolveConflict(rom, resolution, await this.emulatorFor(rom));
  }

  /** The core that would run this game, as the emulator label for uploads. */
  private async emulatorFor(
    rom: SyncableRom & { platform_fs_slug: string },
  ): Promise<string | null> {
    const status = await this.launcher.getRetroArchStatus();
    const resolution = resolveCore({
      romId: rom.id,
      platformSlug: rom.platform_slug,
      platformFsSlug: rom.platform_fs_slug,
      overrides: this.settings.get().coreOverrides,
      defaults: DEFAULT_CORES,
      installed: new Set(status.installedCores),
    });
    return resolution.found ? emulatorName(resolution.core) : null;
  }

  /** Registers this PC with RomM once, so saves show which device they came from. */
  private async ensureDeviceId(): Promise<string | null> {
    const { deviceId, deviceName } = this.settings.get();
    if (deviceId) return deviceId;
    try {
      const registered = await this.requireConnection().client.registerDevice({
        name: deviceName,
        hostname: this.options.hostname,
        platform: process.platform,
        clientVersion: this.options.appVersion,
      });
      this.settings.update({ deviceId: registered });
      return registered;
    } catch (error) {
      // Device tracking is a nicety; saves still sync without it.
      log.warn('Could not register this device with RomM', error);
      return null;
    }
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

function accountKey(serverUrl: string, username: string): string {
  return `${serverUrl}|${username}`;
}
