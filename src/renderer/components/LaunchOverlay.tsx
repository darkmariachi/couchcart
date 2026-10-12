import { useState } from 'react';
import type { LaunchState } from '../../shared/ipc';
import { Dialog, MessageDialog } from './Dialog';
import styles from './ui.module.css';

/**
 * Covers the UI while a game is being fetched and started, so "Play" feels like one step,
 * and reports a failed launch or a save conflict afterwards.
 */
export function LaunchOverlay({ state }: { state: LaunchState }) {
  // Remember which outcome the user has already dismissed.
  const [dismissed, setDismissed] = useState<LaunchState | null>(null);
  if (state === dismissed) return null;
  const dismiss = () => setDismissed(state);

  switch (state.phase) {
    case 'downloading': {
      const percent = state.totalBytes ? (state.receivedBytes / state.totalBytes) * 100 : 0;
      return (
        <Dialog title="Loading game…">
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.muted}>{percent.toFixed(0)}%</span>
        </Dialog>
      );
    }
    case 'starting':
      return <Dialog title="Starting…">{null}</Dialog>;
    case 'syncing':
      return (
        <Dialog title={state.stage === 'before-launch' ? 'Checking saves…' : 'Saving progress…'}>
          {null}
        </Dialog>
      );
    case 'failed':
      return (
        <MessageDialog title="Could not start" message={state.error.message} onClose={dismiss} />
      );
    case 'exited':
      if (state.sync.status === 'synced') return null;
      return (
        <MessageDialog
          title={SYNC_PROBLEM[state.sync.status].title}
          message={SYNC_PROBLEM[state.sync.status].message}
          onClose={dismiss}
        />
      );
    default:
      return null;
  }
}

const SYNC_PROBLEM = {
  conflict: {
    title: 'Save conflict',
    message:
      'This game was also played on another device. Both saves are kept: open the game page to choose which one to continue with.',
  },
  offline: {
    title: 'Not synced yet',
    message:
      'The RomM server could not be reached, so your progress is only on this PC for now. It will upload the next time you play or sync this game.',
  },
  error: {
    title: 'Save sync problem',
    message:
      'Your progress is safe on this PC, but it could not be synced. Open the game page and choose "Sync saves" to try again.',
  },
} as const;
