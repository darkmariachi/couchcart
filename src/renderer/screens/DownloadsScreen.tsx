import { useMutation } from '@tanstack/react-query';
import type { DownloadJob } from '../../shared/ipc';
import { unwrap } from '../api';
import { Focusable } from '../components/Focusable';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { formatSize } from '../format';
import { useDownloads } from '../hooks';
import { useControls } from '../input/controls';
import { useUi } from '../store/ui';

export function DownloadsScreen() {
  const pop = useUi((state) => state.pop);
  const jobs = useDownloads();

  const cancel = useMutation({
    mutationFn: (romId: number) => unwrap(window.romm.downloads.cancel(romId)),
  });
  const retry = useMutation({
    mutationFn: (romId: number) => unwrap(window.romm.game.download(romId)),
  });
  const clearFinished = useMutation({
    mutationFn: () => unwrap(window.romm.downloads.clearFinished()),
  });

  const hasFinished = jobs.some((job) => !isActive(job));
  useControls(
    {
      back: { label: 'Back', run: pop },
      ...(hasFinished && { x: { label: 'Clear finished', run: () => clearFinished.mutate() } }),
    },
    { level: 10 },
  );

  return (
    <Screen title="Downloads" subtitle={describeQueue(jobs)}>
      {jobs.length === 0 && (
        <p className={ui.muted}>
          Nothing is downloading. Games download by themselves when you play them, or choose
          “Download” on a game’s page to fetch it ahead of time.
        </p>
      )}
      <div className={ui.rowGroup}>
        {jobs.map((job) => (
          <Focusable
            key={job.romId}
            className={ui.settingRow}
            focusKey={`download-${job.romId}`}
            onPress={() => {
              if (isActive(job)) cancel.mutate(job.romId);
              else if (job.status !== 'done') retry.mutate(job.romId);
            }}
          >
            <span>{job.name}</span>
            <span className={job.status === 'failed' ? ui.error : ui.settingValue}>
              {describeJob(job)}
            </span>
          </Focusable>
        ))}
      </div>
    </Screen>
  );
}

function isActive(job: DownloadJob): boolean {
  return job.status === 'queued' || job.status === 'downloading';
}

function describeQueue(jobs: DownloadJob[]): string | undefined {
  const active = jobs.filter(isActive).length;
  return active > 0 ? `${active} in progress` : undefined;
}

function describeJob(job: DownloadJob): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting · A to cancel';
    case 'downloading': {
      const percent = job.totalBytes ? Math.round((job.receivedBytes / job.totalBytes) * 100) : 0;
      const speed = job.bytesPerSecond > 0 ? ` · ${formatSize(job.bytesPerSecond)}/s` : '';
      return `${percent}% of ${formatSize(job.totalBytes)}${speed} · A to cancel`;
    }
    case 'done':
      return `Done · ${formatSize(job.totalBytes)}`;
    case 'cancelled':
      return 'Cancelled · A to download again';
    case 'failed':
      return `${job.error ?? 'Failed'} · A to try again`;
  }
}
