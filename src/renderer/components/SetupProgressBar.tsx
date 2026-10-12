import { useEffect, useState } from 'react';
import type { SetupProgress } from '../../shared/ipc';
import { formatSize } from '../format';
import styles from './ui.module.css';

/** Shows a RetroArch or core download while one is running; `idle` is shown before it reports. */
export function SetupProgressBar({ idle }: { idle: string }) {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  useEffect(() => window.romm.retroarch.onSetupProgress(setProgress), []);

  if (!progress) return <p className={styles.muted}>{idle}</p>;
  if (progress.stage === 'unpacking') {
    return <p className={styles.muted}>Unpacking {progress.item}…</p>;
  }
  const { receivedBytes, totalBytes } = progress;
  const percent = totalBytes ? (receivedBytes / totalBytes) * 100 : 0;
  return (
    <>
      <div className={styles.progressTrack}>
        <div className={styles.progressBar} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.muted}>
        Downloading {progress.item}: {formatSize(receivedBytes)}
        {totalBytes ? ` of ${formatSize(totalBytes)}` : ''}
      </p>
    </>
  );
}
