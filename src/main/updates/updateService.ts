import type { UpdateState } from '../../shared/ipc';
import { log } from '../logging/logger';

/** Replaces the running copy of the app with a newer one. */
export interface SelfUpdater {
  /** The newest published version. */
  latestVersion(): Promise<string>;
  download(onProgress: (percent: number) => void): Promise<void>;
  /** Closes the app, installs the downloaded version and starts it. */
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  /** Null for copies that cannot replace themselves: the portable build and the tar.gz. */
  selfUpdater: SelfUpdater | null;
  /** Used to find the newest version when there is no self-updater. */
  fetchLatestVersion: () => Promise<string>;
  /** Whether the user lets the app look for updates on its own. */
  isAutomatic: () => boolean;
  openDownloadPage: () => void;
  onChanged: (state: UpdateState) => void;
}

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * Finds out whether a newer version has been published. A copy that can update itself
 * downloads it in the background and installs it when the app closes; any other copy
 * only says so and offers the download page.
 */
export class UpdateService {
  private state: UpdateState;
  private running: Promise<UpdateState> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly options: UpdateServiceOptions) {
    this.state = {
      currentVersion: options.currentVersion,
      selfUpdating: options.selfUpdater !== null,
      status: 'idle',
      latestVersion: null,
      percent: null,
      error: null,
    };
  }

  /** Checks shortly after start and a few times a day, while the setting allows it. */
  start(): void {
    const automaticCheck = () => {
      if (this.options.isAutomatic()) void this.check();
    };
    this.timers = [
      setTimeout(automaticCheck, FIRST_CHECK_DELAY_MS),
      setInterval(automaticCheck, CHECK_INTERVAL_MS),
    ];
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  getState(): UpdateState {
    return this.state;
  }

  /** Never rejects: a failure is reported in the state. */
  check(): Promise<UpdateState> {
    // A version that is already downloaded stays ready; there is nothing more to find out.
    if (this.state.status === 'ready') return Promise.resolve(this.state);
    this.running ??= this.runCheck().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Installs the downloaded version, or opens the download page when this copy cannot. */
  install(): undefined {
    if (this.state.status === 'ready') this.options.selfUpdater?.quitAndInstall();
    else if (this.state.status === 'available') this.options.openDownloadPage();
  }

  private async runCheck(): Promise<UpdateState> {
    this.set({ status: 'checking', percent: null, error: null });
    try {
      const { latestVersion, selfUpdater } = await this.findLatest();

      if (!isNewerVersion(latestVersion, this.options.currentVersion)) {
        return this.set({ status: 'current', latestVersion });
      }
      if (!selfUpdater) return this.set({ status: 'available', latestVersion });

      this.set({ status: 'downloading', latestVersion, percent: 0 });
      await selfUpdater.download((percent) => this.set({ percent: Math.round(percent) }));
      return this.set({ status: 'ready', percent: null });
    } catch (error) {
      log.warn('Update check failed', error);
      return this.set({ status: 'failed', percent: null, error: firstLine(error) });
    }
  }

  /**
   * The newest version, and the updater that can install it. A release the self-updater
   * cannot read (one published without its update files) is still found, as a version
   * to download by hand.
   */
  private async findLatest(): Promise<{ latestVersion: string; selfUpdater: SelfUpdater | null }> {
    const { selfUpdater } = this.options;
    if (selfUpdater) {
      try {
        return { latestVersion: withoutPrefix(await selfUpdater.latestVersion()), selfUpdater };
      } catch (error) {
        log.warn(`The self-updater could not read the latest release: ${firstLine(error)}`);
      }
    }
    const latestVersion = withoutPrefix(await this.options.fetchLatestVersion());
    return { latestVersion, selfUpdater: null };
  }

  private set(change: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...change };
    this.options.onChanged(this.state);
    return this.state;
  }
}

function withoutPrefix(version: string): string {
  return version.replace(/^v/, '');
}

/** Library errors can run to pages (response headers, stacks); the first line says enough. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message.split('\n')[0]?.trim().slice(0, 300) || 'Unexpected error.';
}

/** Compares `major.minor.patch`; anything after the numbers (a pre-release tag) is ignored. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) =>
    (/^v?(\d+(?:\.\d+)*)/.exec(version)?.[1] ?? '').split('.').map(Number);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
