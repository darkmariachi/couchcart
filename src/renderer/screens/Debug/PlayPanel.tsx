import { useMutation } from '@tanstack/react-query';
import type { LaunchState } from '../../../shared/ipc';
import { unwrap } from '../../api';
import { useLaunchState } from '../../hooks';
import styles from './Debug.module.css';

export function PlayPanel({ romId }: { romId: number }) {
  const state = useLaunchState();
  // Failures also arrive through the launch state, which is what gets displayed.
  const play = useMutation({ mutationFn: () => unwrap(window.romm.game.play(romId)) });

  const busy = ['downloading', 'starting', 'syncing', 'running'].includes(state.phase);

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Play ROM {romId}</h2>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => play.mutate()} disabled={busy}>
          Download and play
        </button>
        <span className={state.phase === 'failed' ? styles.error : styles.muted}>
          {describe(state)}
        </span>
      </div>
    </section>
  );
}

function describe(state: LaunchState): string {
  switch (state.phase) {
    case 'idle':
      return 'Nothing running.';
    case 'downloading': {
      const percent = state.totalBytes ? (state.receivedBytes / state.totalBytes) * 100 : 0;
      return `Downloading ROM ${state.romId}… ${percent.toFixed(0)}%`;
    }
    case 'starting':
      return `Starting ROM ${state.romId}…`;
    case 'syncing':
      return state.stage === 'before-launch'
        ? 'Checking the server for newer saves…'
        : 'Uploading saves…';
    case 'running':
      return `ROM ${state.romId} is running in RetroArch (${state.core}).`;
    case 'exited':
      return `ROM ${state.romId} exited with code ${state.exitCode ?? 'unknown'} after ${state.playedSeconds}s. Saves: ${state.sync.status}.`;
    case 'failed':
      return state.error.message;
  }
}
