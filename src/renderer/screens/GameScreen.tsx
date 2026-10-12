import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  mdiChip,
  mdiClose,
  mdiCloudSync,
  mdiDelete,
  mdiDownload,
  mdiHeart,
  mdiHeartOutline,
  mdiPlay,
} from '@mdi/js';
import type { ConflictResolution, RomDetail, SyncReport } from '../../shared/ipc';
import { assetUrl } from '../assets';
import { errorMessage, unwrap } from '../api';
import { MenuDialog } from '../components/Dialog';
import { Focusable } from '../components/Focusable';
import { Cover } from '../components/GameCard';
import { Icon, PlatformIcon } from '../components/Icon';
import ui from '../components/ui.module.css';
import { formatSize, formatWhen, shortCoreName } from '../format';
import { useDownloads, useRomDetail } from '../hooks';
import { useControls } from '../input/controls';
import { focusFirst, focusedElement } from '../input/focus';
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
  const setFavorite = useMutation({
    mutationFn: (favorite: boolean) => unwrap(window.romm.game.setFavorite({ romId, favorite })),
    onSettled: refresh,
  });
  const [choosingCore, setChoosingCore] = useState(false);
  const cancelDownload = useMutation({
    mutationFn: () => unwrap(window.romm.downloads.cancel(romId)),
  });

  const jobs = useDownloads().filter((candidate) => candidate.romId === romId);
  const job = jobs.find((candidate) => ['queued', 'downloading'].includes(candidate.status));
  // The page shows "downloaded" as soon as the queue finishes this game.
  const jobDone = jobs.some((candidate) => candidate.status === 'done');
  useEffect(() => {
    if (jobDone) void queryClient.invalidateQueries({ queryKey: ['library'] });
  }, [jobDone, queryClient]);

  useControls({ back: { label: 'Back', run: pop } }, { level: 10 });

  const rom = detail.data;
  useEffect(() => {
    if (rom && !focusedElement()?.closest('[data-screen]')) focusFirst();
  }, [rom]);

  if (!rom) {
    return (
      <div className={ui.screen} data-screen="">
        <div className={ui.content}>
          {detail.isPending && <p className={ui.muted}>Loading…</p>}
          {detail.isError && <p className={ui.error}>{errorMessage(detail.error)}</p>}
        </div>
      </div>
    );
  }

  const artwork = rom.coverLargePath ?? rom.coverPath;
  return (
    <div className={ui.screen} data-screen="" data-ambient={artwork ?? undefined}>
      <div className={ui.content} data-scroll-container="">
        <div className={styles.detail}>
          <div className={styles.detailCover}>
            <Cover path={artwork} title={rom.name} />
          </div>

          <div>
            <h1 className={styles.gameTitle}>{rom.name}</h1>
            <div className={styles.platformLine}>
              <PlatformIcon slug={rom.platformSlug} className={styles.platformLineIcon} />
              {rom.platformName}
              {rom.regions.map((region) => (
                <span key={region} className={ui.pill}>
                  {region}
                </span>
              ))}
              {rom.downloaded && <span className={`${ui.pill} ${ui.ok}`}>On this PC</span>}
            </div>

            <div className={styles.actions}>
              <Focusable
                variant="primary"
                className={styles.playButton}
                preferred
                onPress={() => play.mutate()}
              >
                <Icon path={mdiPlay} />
                Play
              </Focusable>

              {rom.downloaded ? (
                <Focusable
                  variant="button"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate()}
                >
                  <Icon path={mdiDelete} />
                  Delete local copy
                </Focusable>
              ) : job ? (
                <Focusable variant="button" onPress={() => cancelDownload.mutate()}>
                  <Icon path={mdiClose} />
                  {job.status === 'queued'
                    ? 'Queued · cancel'
                    : `${job.totalBytes ? Math.round((job.receivedBytes / job.totalBytes) * 100) : 0}% · cancel`}
                </Focusable>
              ) : (
                <Focusable variant="button" onPress={() => download.mutate()}>
                  <Icon path={mdiDownload} />
                  Download
                </Focusable>
              )}

              <Focusable
                variant="button"
                className={rom.favorite ? styles.favoriteOn : undefined}
                disabled={setFavorite.isPending}
                onPress={() => setFavorite.mutate(!rom.favorite)}
              >
                <Icon path={rom.favorite ? mdiHeart : mdiHeartOutline} />
                {rom.favorite ? 'Favourite' : 'Add to favourites'}
              </Focusable>

              <Focusable variant="button" disabled={sync.isPending} onPress={() => sync.mutate()}>
                <Icon path={mdiCloudSync} />
                {sync.isPending ? 'Syncing…' : 'Sync saves'}
              </Focusable>

              {rom.coreOptions.length > 1 && (
                <Focusable variant="button" onPress={() => setChoosingCore(true)}>
                  <Icon path={mdiChip} />
                  {rom.core ? shortCoreName(rom.core) : 'No core'}
                  {rom.coreOverride ? '' : ' (automatic)'}
                </Focusable>
              )}
            </div>

            {[remove, setFavorite, resolve, setCore].map(
              (mutation, index) =>
                mutation.isError && (
                  <p key={index} className={ui.error}>
                    {errorMessage(mutation.error)}
                  </p>
                ),
            )}

            {rom.description && <p className={styles.description}>{rom.description}</p>}

            <div className={styles.facts}>
              {rom.releaseYear && <Fact label="Released" value={String(rom.releaseYear)} />}
              {rom.genres.length > 0 && (
                <Fact label="Genre" value={rom.genres.slice(0, 2).join(', ')} />
              )}
              {rom.companies.length > 0 && (
                <Fact label="By" value={rom.companies.slice(0, 2).join(', ')} />
              )}
              {rom.rating !== null && <Fact label="Rating" value={`${Math.round(rom.rating)}%`} />}
              {rom.playerCount && <Fact label="Players" value={rom.playerCount} />}
              <Fact label="Size" value={formatSize(rom.sizeBytes)} />
              {rom.lastPlayed && <Fact label="Last played" value={formatWhen(rom.lastPlayed)} />}
            </div>

            {rom.screenshots.length > 0 && (
              <div className={styles.screenshots}>
                {rom.screenshots.slice(0, 3).map((path) => (
                  <img
                    key={path}
                    className={styles.screenshot}
                    src={assetUrl(path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ))}
              </div>
            )}

            {choosingCore && (
              <MenuDialog
                title={`Core for ${rom.name}`}
                onClose={() => setChoosingCore(false)}
                items={[
                  {
                    label: `Automatic (the ${rom.platformName} setting)`,
                    selected: rom.coreOverride === null,
                    run: () => setCore.mutate(null),
                  },
                  ...rom.coreOptions.map((core) => ({
                    label: shortCoreName(core),
                    selected: rom.coreOverride === core,
                    run: () => setCore.mutate(core),
                  })),
                ]}
              />
            )}

            <SaveStatus
              rom={rom}
              busy={resolve.isPending}
              onResolve={(resolution) => resolve.mutate(resolution)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.factValue}>{value}</div>
      <div className={styles.factLabel}>{label}</div>
    </div>
  );
}

const SYNC_TEXT: Record<SyncReport['status'], string> = {
  synced: 'In sync with RomM',
  conflict: 'Different saves on this PC and on RomM. Choose which to keep:',
  offline: 'Not synced: the RomM server could not be reached',
  error: 'The last save sync ran into a problem',
};

function SaveStatus(props: {
  rom: RomDetail;
  busy: boolean;
  onResolve: (resolution: ConflictResolution) => void;
}) {
  const report = props.rom.lastSync;
  const conflicts = report?.items.filter((item) => item.outcome === 'conflict') ?? [];

  return (
    <div className={`${ui.widget} ${styles.statusBox}`}>
      <h2 className={ui.widgetTitle}>Saves</h2>
      {!report && <span className={ui.muted}>Not synced on this PC yet.</span>}
      {report && (
        <>
          <p className={report.status === 'synced' ? ui.ok : ui.error}>
            {SYNC_TEXT[report.status]}
          </p>
          <span className={ui.muted}>Last checked {formatWhen(report.at)}</span>
        </>
      )}

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
