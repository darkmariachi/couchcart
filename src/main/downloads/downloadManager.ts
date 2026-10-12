import type { DownloadJob } from '../../shared/ipc';
import { LauncherError } from '../errors';
import { log } from '../logging/logger';
import { downloadRom, type RomContentSource, type RomDownload } from './romDownloader';

export interface DownloadRequest {
  romId: number;
  name: string;
  files: RomDownload[];
}

interface QueueEntry {
  request: DownloadRequest;
  job: DownloadJob;
  abort: AbortController;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

const NOTIFY_INTERVAL_MS = 250;

/**
 * Downloads games one at a time, in order. One at a time on purpose: on a home network a
 * single transfer already uses the whole link, and a queue is easy to follow from the couch.
 */
export class DownloadManager {
  private readonly entries: QueueEntry[] = [];
  private active: QueueEntry | null = null;
  private lastNotify = 0;

  constructor(
    /** Throws when not logged in. */
    private readonly getSource: () => RomContentSource,
    private readonly onChanged: (jobs: DownloadJob[]) => void,
    private readonly download: typeof downloadRom = downloadRom,
    private readonly now: () => number = Date.now,
  ) {}

  list(): DownloadJob[] {
    return this.entries.map((entry) => ({ ...entry.job }));
  }

  /**
   * Adds a game to the queue and resolves when it has been downloaded. A game the user is
   * waiting to play passes `priority` to go next. Asking for a game that is already queued
   * joins the existing job.
   */
  enqueue(request: DownloadRequest, options: { priority?: boolean } = {}): Promise<void> {
    let entry = this.entries.find(
      (candidate) =>
        candidate.request.romId === request.romId &&
        (candidate.job.status === 'queued' || candidate.job.status === 'downloading'),
    );

    if (!entry) {
      // A finished or failed attempt for the same game is replaced by the new one.
      this.removeWhere((candidate) => candidate.request.romId === request.romId);
      entry = {
        request,
        abort: new AbortController(),
        waiters: [],
        job: {
          romId: request.romId,
          name: request.name,
          status: 'queued',
          receivedBytes: 0,
          totalBytes: request.files.reduce((total, file) => total + file.sizeBytes, 0),
          bytesPerSecond: 0,
          error: null,
        },
      };
      this.entries.push(entry);
    }

    if (options.priority && entry.job.status === 'queued') {
      this.entries.splice(this.entries.indexOf(entry), 1);
      const firstQueued = this.entries.findIndex((candidate) => candidate.job.status === 'queued');
      this.entries.splice(firstQueued === -1 ? this.entries.length : firstQueued, 0, entry);
    }

    const { waiters } = entry;
    const finished = new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
    this.notify(true);
    void this.pump();
    return finished;
  }

  cancel(romId: number): void {
    const entry = this.entries.find(
      (candidate) =>
        candidate.request.romId === romId &&
        (candidate.job.status === 'queued' || candidate.job.status === 'downloading'),
    );
    if (!entry) return;

    if (entry === this.active) {
      entry.abort.abort(); // run() settles the entry when the transfer stops
    } else {
      this.settle(entry, 'cancelled', new LauncherError('cancelled', 'Download cancelled.'));
    }
  }

  clearFinished(): void {
    this.removeWhere((entry) => !['queued', 'downloading'].includes(entry.job.status));
    this.notify(true);
  }

  private removeWhere(predicate: (entry: QueueEntry) => boolean): void {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (entry && entry !== this.active && predicate(entry)) this.entries.splice(index, 1);
    }
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const next = this.entries.find((entry) => entry.job.status === 'queued');
    if (!next) return;

    this.active = next;
    await this.run(next);
    this.active = null;
    void this.pump();
  }

  private async run(entry: QueueEntry): Promise<void> {
    const { job, request } = entry;
    job.status = 'downloading';
    this.notify(true);

    let completedBytes = 0;
    let speedSample = { at: this.now(), bytes: 0 };
    try {
      const source = this.getSource();
      for (const file of request.files) {
        await this.download(source, file, {
          signal: entry.abort.signal,
          onProgress: ({ receivedBytes }) => {
            job.receivedBytes = completedBytes + receivedBytes;
            const elapsed = this.now() - speedSample.at;
            if (elapsed >= 1000) {
              job.bytesPerSecond = ((job.receivedBytes - speedSample.bytes) / elapsed) * 1000;
              speedSample = { at: this.now(), bytes: job.receivedBytes };
            }
            this.notify(false);
          },
        });
        completedBytes += file.sizeBytes;
        job.receivedBytes = completedBytes;
      }
      this.settle(entry, 'done', null);
    } catch (error) {
      if (entry.abort.signal.aborted) {
        this.settle(entry, 'cancelled', new LauncherError('cancelled', 'Download cancelled.'));
      } else {
        log.warn(`Download of ROM ${request.romId} failed`, error);
        this.settle(entry, 'failed', error);
      }
    }
  }

  private settle(entry: QueueEntry, status: DownloadJob['status'], error: unknown): void {
    entry.job.status = status;
    entry.job.bytesPerSecond = 0;
    entry.job.error =
      status === 'failed' ? (error instanceof Error ? error.message : 'Download failed.') : null;
    for (const waiter of entry.waiters.splice(0)) {
      if (status === 'done') waiter.resolve();
      else waiter.reject(error);
    }
    this.notify(true);
  }

  /** Progress updates are throttled; state changes always go out. */
  private notify(force: boolean): void {
    const now = this.now();
    if (!force && now - this.lastNotify < NOTIFY_INTERVAL_MS) return;
    this.lastNotify = now;
    this.onChanged(this.list());
  }
}
