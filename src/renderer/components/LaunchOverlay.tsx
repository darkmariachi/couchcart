import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  ConflictResolution,
  LaunchBlock,
  LaunchState,
  SyncItemResult,
} from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { formatWhen, shortCoreName } from '../format';
import { Dialog, MessageDialog } from './Dialog';
import { Focusable } from './Focusable';
import { SetupProgressBar } from './SetupProgressBar';
import styles from './ui.module.css';

/**
 * Covers the UI while a game is being fetched and started, so "Play" feels like one step.
 * It also asks the questions a launch can stop at, and reports problems afterwards.
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
    case 'installing-core':
      return (
        <Dialog title="Getting the core…">
          <SetupProgressBar idle="Contacting the download server…" />
        </Dialog>
      );
    case 'syncing':
      return (
        <Dialog title={state.stage === 'before-launch' ? 'Checking saves…' : 'Saving progress…'}>
          {null}
        </Dialog>
      );
    case 'blocked':
      return <BlockedDialog romId={state.romId} block={state.block} onCancel={dismiss} />;
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

function BlockedDialog(props: { romId: number; block: LaunchBlock; onCancel: () => void }) {
  const { romId, block } = props;

  // Starting again replaces the blocked state, which closes this dialog.
  const play = useMutation({
    mutationFn: (options: {
      ignoreConflicts?: boolean;
      ignoreMissingBios?: boolean;
      installCore?: boolean;
    }) => unwrap(window.romm.game.play({ romId, ...options })),
  });
  const resolveAll = useMutation({
    mutationFn: async (keep: ConflictResolution['keep']) => {
      if (block.type !== 'conflict') return;
      for (const item of block.conflicts) {
        await unwrap(
          window.romm.saves.resolveConflict({
            romId,
            kind: item.kind,
            fileName: item.fileName,
            keep,
          }),
        );
      }
    },
    onSuccess: () => play.mutate({}),
  });
  const busy = play.isPending || resolveAll.isPending;
  const controls = { back: { label: 'Cancel', run: props.onCancel } };

  if (block.type === 'bios') {
    return (
      <Dialog title={`${block.platformName} needs a BIOS file`} controls={controls}>
        <p className={styles.dialogText}>
          RetroArch needs these files to run {block.platformName} games, and they were not found:
        </p>
        <ul className={styles.dialogList}>
          {block.missing.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
        <p className={styles.muted}>Put them in: {block.systemDir}</p>
        <Focusable
          className={styles.menuItem}
          disabled={busy}
          onPress={() => play.mutate({ ignoreMissingBios: true })}
        >
          Play anyway
        </Focusable>
        <Focusable className={styles.menuItem} preferred onPress={props.onCancel}>
          Cancel
        </Focusable>
      </Dialog>
    );
  }

  if (block.type === 'core') {
    const [core] = block.cores;
    return (
      <Dialog title={`${block.platformName} needs a core`} controls={controls}>
        <p className={styles.dialogText}>
          RetroArch runs each console with an add-on called a core, and none is installed for{' '}
          {block.platformName} yet. The launcher can download {core ? shortCoreName(core) : 'one'}{' '}
          from libretro, the makers of RetroArch.
        </p>
        <Focusable
          className={styles.menuItem}
          preferred
          disabled={busy}
          onPress={() => play.mutate({ installCore: true })}
        >
          Download and play
        </Focusable>
        <Focusable className={styles.menuItem} onPress={props.onCancel}>
          Cancel
        </Focusable>
      </Dialog>
    );
  }

  const [first] = block.conflicts;
  return (
    <Dialog title="Which save do you want to continue?" controls={controls}>
      <p className={styles.dialogText}>
        This game was played here and somewhere else since the last sync. The one you do not pick is
        kept as a backup.
      </p>
      <Focusable
        className={styles.menuItem}
        preferred
        disabled={busy}
        onPress={() => resolveAll.mutate('local')}
      >
        Use this PC&apos;s save{describeLocal(first)}
      </Focusable>
      <Focusable
        className={styles.menuItem}
        disabled={busy}
        onPress={() => resolveAll.mutate('server')}
      >
        Use the RomM save{describeServer(first)}
      </Focusable>
      <Focusable
        className={styles.menuItem}
        disabled={busy}
        onPress={() => play.mutate({ ignoreConflicts: true })}
      >
        Decide later (play with this PC&apos;s save)
      </Focusable>
      {resolveAll.isError && <p className={styles.error}>{errorMessage(resolveAll.error)}</p>}
    </Dialog>
  );
}

function describeLocal(item: SyncItemResult | undefined): string {
  const when = item?.conflict?.localModifiedAt;
  return when ? ` (played ${formatWhen(when)})` : '';
}

function describeServer(item: SyncItemResult | undefined): string {
  const detail = item?.conflict;
  if (!detail?.serverUpdatedAt) return '';
  const device = detail.serverDevice ? ` on ${detail.serverDevice}` : '';
  return ` (played ${formatWhen(detail.serverUpdatedAt)}${device})`;
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
      'The RomM server could not be reached, so your progress is only on this PC for now. It uploads by itself once the server is reachable again.',
  },
  error: {
    title: 'Save sync problem',
    message:
      'Your progress is safe on this PC, but it could not be synced. The launcher will keep retrying; you can also choose "Sync saves" on the game page.',
  },
} as const;
