import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../src/shared/ipc';
import { fetchLatestReleaseVersion } from '../src/main/updates/github';
import {
  UpdateService,
  isNewerVersion,
  type SelfUpdater,
  type UpdateServiceOptions,
} from '../src/main/updates/updateService';

function service(overrides: Partial<UpdateServiceOptions> = {}) {
  const states: UpdateState[] = [];
  const openDownloadPage = vi.fn();
  const updates = new UpdateService({
    currentVersion: '0.2.0',
    selfUpdater: null,
    fetchLatestVersion: async () => 'v0.3.0',
    isAutomatic: () => true,
    openDownloadPage,
    onChanged: (state) => states.push(state),
    ...overrides,
  });
  return { updates, states, openDownloadPage };
}

function selfUpdater(latest: string) {
  return {
    latestVersion: async () => latest,
    download: vi.fn(async (onProgress: (percent: number) => void) => {
      onProgress(41.6);
    }),
    quitAndInstall: vi.fn(),
  } satisfies SelfUpdater;
}

describe('isNewerVersion', () => {
  it.each([
    ['0.3.0', '0.2.0', true],
    ['v0.2.1', '0.2.0', true],
    ['1.0.0', '0.9.9', true],
    ['0.10.0', '0.9.0', true],
    ['0.2.0', '0.2.0', false],
    ['0.1.9', '0.2.0', false],
    ['0.2.0-beta.1', '0.2.0', false],
  ])('%s against %s is %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});

describe('UpdateService', () => {
  it('reports that the installed version is the newest', async () => {
    const { updates } = service({ fetchLatestVersion: async () => 'v0.2.0' });

    expect(await updates.check()).toMatchObject({ status: 'current', latestVersion: '0.2.0' });
  });

  it('only announces a newer version when this copy cannot update itself', async () => {
    const { updates, openDownloadPage } = service();

    expect(await updates.check()).toMatchObject({
      status: 'available',
      latestVersion: '0.3.0',
      selfUpdating: false,
    });
    updates.install();
    expect(openDownloadPage).toHaveBeenCalledOnce();
  });

  it('downloads a newer version and installs it when asked', async () => {
    const updater = selfUpdater('0.3.0');
    const { updates, states, openDownloadPage } = service({ selfUpdater: updater });

    expect(await updates.check()).toMatchObject({ status: 'ready', latestVersion: '0.3.0' });
    expect(states.map((state) => state.status)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready',
    ]);
    expect(states[2]?.percent).toBe(42);

    updates.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(openDownloadPage).not.toHaveBeenCalled();
  });

  it('does not download when the installed version is the newest', async () => {
    const updater = selfUpdater('0.2.0');
    const { updates } = service({ selfUpdater: updater });

    expect((await updates.check()).status).toBe('current');
    expect(updater.download).not.toHaveBeenCalled();
    updates.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps a downloaded version ready instead of checking again', async () => {
    const updater = selfUpdater('0.3.0');
    const { updates } = service({ selfUpdater: updater });
    await updates.check();

    expect((await updates.check()).status).toBe('ready');
    expect(updater.download).toHaveBeenCalledOnce();
  });

  it('falls back to announcing a version the self-updater cannot read', async () => {
    const updater = {
      ...selfUpdater('0.3.0'),
      latestVersion: async () => {
        throw new Error('Cannot find latest.yml in the latest release artifacts\nHeaders: {}');
      },
    };
    const { updates, openDownloadPage } = service({ selfUpdater: updater });

    expect(await updates.check()).toMatchObject({ status: 'available', latestVersion: '0.3.0' });
    expect(updater.download).not.toHaveBeenCalled();
    updates.install();
    expect(openDownloadPage).toHaveBeenCalledOnce();
  });

  it('shows only the first line of a long error', async () => {
    const { updates } = service({
      fetchLatestVersion: async () => {
        throw new Error('GitHub could not be reached.\nHeaders: {}\n    at somewhere');
      },
    });

    expect((await updates.check()).error).toBe('GitHub could not be reached.');
  });

  it('reports a failed check without throwing, and can try again', async () => {
    const fetchLatestVersion = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('GitHub answered with HTTP 503.'))
      .mockResolvedValue('v0.2.0');
    const { updates } = service({ fetchLatestVersion });

    expect(await updates.check()).toMatchObject({
      status: 'failed',
      error: 'GitHub answered with HTTP 503.',
    });
    expect((await updates.check()).status).toBe('current');
  });

  it('runs one check at a time', async () => {
    const fetchLatestVersion = vi.fn(async () => 'v0.3.0');
    const { updates } = service({ fetchLatestVersion });

    await Promise.all([updates.check(), updates.check()]);

    expect(fetchLatestVersion).toHaveBeenCalledOnce();
  });

  it('checks on its own only while the setting allows it', async () => {
    vi.useFakeTimers();
    try {
      let automatic = false;
      const fetchLatestVersion = vi.fn(async () => 'v0.2.0');
      const { updates } = service({ fetchLatestVersion, isAutomatic: () => automatic });
      updates.start();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchLatestVersion).not.toHaveBeenCalled();

      automatic = true;
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      expect(fetchLatestVersion).toHaveBeenCalledOnce();
      updates.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchLatestReleaseVersion', () => {
  it('reads the tag of the latest release', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ tag_name: 'v0.3.0' }));

    expect(await fetchLatestReleaseVersion(fetchImpl)).toBe('v0.3.0');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/darkmariachi/couchcart/releases/latest',
    );
  });

  it('fails on an error response', async () => {
    const fetchImpl: typeof fetch = async () => new Response('rate limited', { status: 403 });

    await expect(fetchLatestReleaseVersion(fetchImpl)).rejects.toThrow('HTTP 403');
  });
});
