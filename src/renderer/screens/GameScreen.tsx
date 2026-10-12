import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConflictResolution, RomDetail, SyncReport } from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { Focusable } from '../components/Focusable';
import { Cover } from '../components/GameCard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { formatSize, formatWhen, nextOption, shortCoreName } from '../format';
import { useDownloads, useRomDetail } from '../hooks';
import { useControls } from '../input/controls';
import { useUi } from '../store/ui';
import styles from './screens.module.css';

export function GameScreen({ romId }: { romId: number }) {
  const pop = useUi((state) => state.pop);
  const queryClient = useQueryClient();
  const detail = useRomDetail(romId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library'] });

  // Progress and failures of play/download are shown by the app-wide launch overlay.
  const play = useMutation({ mutationFn: () => unwrap(window.romm.game.play({ romId })) });
  const download = useMutation({
    mutationFn: () => unwrap(window.romm.game.download(romId)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => unwrap(window.romm.game.deleteLocal(romId)),
    onSettled: refresh,
  });
  const sync = useMutation({
    mutationFn: () => unwrap(window.romm.saves.sync(romId)),
    onSettled: refresh,
  });
  const resolve = useMutation({
    mutationFn: (resolution: ConflictResolution) =>
      unwrap(window.romm.saves.resolveConflict(resolution)),
    onSettled: refresh,
  });

  const setCore = useMutation({
    mutationFn: (core: string | null) => unwrap(window.romm.game.setCore({ romId, core })),
    onSettled: refresh,
  });
  const cancelDownload = useMutation({
    mutationFn: () => unwrap(window.romm.downloads.cancel(romId)),
  });

  const job = useDownloads().find(
    (candidate) =>
      candidate.romId === romId &&
      (candidate.status === 'queued' || candidate.status === 'downloading'),
  );
  // The page shows "downloaded" as soon as the queue finishes this game.
  const jobDone = useDownloads().some(
    (candidate) => candidate.romId === romId && candidate.status === 'done',
  );
  useEffect(() => {
    if (jobDone) void queryClient.invalidateQueries({ queryKey: ['library'] });
  }, [jobDone, queryClient]);

  useControls({ back: { label: 'Back', run: pop } }, { level: 10 });

  const rom = detail.data;
  return (
    <Screen title={rom?.name ?? 'Game'} subtitle={rom?.platformName} ready={detail.isSuccess}>
      {detail.isPending && <p className={ui.muted}>Loading…</p>}
      {detail.isError && <p className={ui.error}>{errorMessage(detail.error)}</p>}
      {rom && (
        <div className={styles.detail}>
          <Cover path={rom.coverLargePath ?? rom.coverPath} title={rom.name} />
          <div>
            <div className={styles.facts}>
              {rom.releaseYear && <span>{rom.releaseYear}</span>}
              {rom.genres.length > 0 && <span>{rom.genres.slice(0, 3).join(', ')}</span>}
              <span>{formatSize(rom.sizeBytes)}</span>
              <span className={rom.downloaded ? ui.ok : undefined}>
                {rom.downloaded ? 'On this PC' : 'Not downloaded'}
              </span>
              {rom.lastPlayed && <span>Last played {formatWhen(rom.lastPlayed)}</span>}
            </div>

            {rom.description && <p className={styles.description}>{rom.description}</p>}

            <div className={styles.actions}>
              <Focusable variant="primary" preferred onPress={() => play.mutate()}>
                Play
              </Focusable>
              {rom.downloaded ? (
                <Focusable
                  variant="button"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate()}
                >
                  Delete local copy
                </Focusable>
              ) : job ? (
                <Focusable variant="button" onPress={() => cancelDownload.mutate()}>
                  {job.status === 'queued'
                    ? 'Queued · cancel'
                    : `Downloading ${job.totalBytes ? Math.round((job.receivedBytes / job.totalBytes) * 100) : 0}% · cancel`}
                </Focusable>
              ) : (
                <Focusable variant="button" onPress={() => download.mutate()}>
                  Download
                </Focusable>
              )}
              <Focusable variant="button" disabled={sync.isPending} onPress={() => sync.mutate()}>
                {sync.isPending ? 'Syncing…' : 'Sync saves'}
              </Focusable>
              {rom.coreOptions.length > 1 && (
                <Focusable
                  variant="button"
                  onPress={() =>
                    setCore.mutate(nextOption([null, ...rom.coreOptions], rom.coreOverride))
                  }
                >
                  Core: {rom.core ? shortCoreName(rom.core) : 'none'}
                  {rom.coreOverride ? '' : ' (automatic)'}
                </Focusable>
              )}
            </div>

            <SaveStatus
              rom={rom}
              busy={resolve.isPending}
              onResolve={(resolution) => resolve.mutate(resolution)}
            />
            {remove.isError && <p className={ui.error}>{errorMessage(remove.error)}</p>}
            {resolve.isError && <p className={ui.error}>{errorMessage(resolve.error)}</p>}
          </div>
        </div>
      )}
    </Screen>
  );
}

const SYNC_TEXT: Record<SyncReport['status'], string> = {
  synced: 'Saves are in sync with RomM.',
  conflict: 'This game has different saves on this PC and on RomM. Choose which to keep:',
  offline: 'Not synced: the RomM server could not be reached.',
  error: 'The last save sync ran into a problem.',
};

function SaveStatus(props: {
  rom: RomDetail;
  busy: boolean;
  onResolve: (resolution: ConflictResolution) => void;
}) {
  const report = props.rom.lastSync;
  if (!report) {
    return (
      <div className={styles.statusBox}>
        <span className={ui.muted}>Saves have not been synced on this PC yet.</span>
      </div>
    );
  }

  const conflicts = report.items.filter((item) => item.outcome === 'conflict');
  return (
    <div className={styles.statusBox}>
      <p className={report.status === 'synced' ? ui.ok : ui.error}>{SYNC_TEXT[report.status]}</p>
      <span className={ui.muted}>Last checked {formatWhen(report.at)}</span>

      {conflicts.map((item) => {
        const keep = (side: ConflictResolution['keep']) =>
          props.onResolve({
            romId: props.rom.id,
            kind: item.kind,
            fileName: item.fileName,
            keep: side,
          });
        return (
          <div key={`${item.kind}:${item.fileName}`} style={{ marginTop: '1rem' }}>
            <p>{item.kind === 'save' ? 'Game save' : `Save state (${item.fileName})`}</p>
            <div className={ui.row}>
              <Focusable variant="button" disabled={props.busy} onPress={() => keep('local')}>
                Use this PC&apos;s
              </Focusable>
              <Focusable variant="button" disabled={props.busy} onPress={() => keep('server')}>
                Use RomM&apos;s
              </Focusable>
            </div>
            <span className={ui.muted}>The other one is kept as a backup.</span>
          </div>
        );
      })}
    </div>
  );
}
