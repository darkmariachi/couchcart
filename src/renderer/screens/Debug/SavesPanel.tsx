import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConflictResolution, SyncItemResult, SyncReport } from '../../../shared/ipc';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

/** Manual save sync for one ROM, the last sync report, and conflict resolution. */
export function SavesPanel({ romId }: { romId: number }) {
  const queryClient = useQueryClient();
  const reportKey = ['syncReport', romId];

  const lastReport = useQuery({
    queryKey: reportKey,
    queryFn: () => unwrap(window.romm.saves.lastReport(romId)),
    staleTime: 0,
  });

  const showReport = (report: SyncReport) => {
    queryClient.setQueryData(reportKey, report);
    void queryClient.invalidateQueries({ queryKey: ['romAssets', romId] });
  };

  const sync = useMutation({
    mutationFn: () => unwrap(window.romm.saves.sync(romId)),
    onSuccess: showReport,
  });

  const resolve = useMutation({
    mutationFn: (resolution: ConflictResolution) =>
      unwrap(window.romm.saves.resolveConflict(resolution)),
    onSuccess: showReport,
  });

  const report = lastReport.data;
  const busy = sync.isPending || resolve.isPending;

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Save sync</h2>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => sync.mutate()} disabled={busy}>
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </button>
        <span className={report?.status === 'synced' ? styles.muted : styles.error}>
          {report
            ? `${report.status} at ${new Date(report.at).toLocaleString()}`
            : 'Never synced on this PC.'}
        </span>
        {sync.isError && <span className={styles.error}>{errorMessage(sync.error)}</span>}
        {resolve.isError && <span className={styles.error}>{errorMessage(resolve.error)}</span>}
      </div>

      {report && report.items.length > 0 && (
        <table className={styles.table} style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>File</th>
              <th>Action</th>
              <th>Result</th>
              <th>Why</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={`${item.kind}:${item.fileName}`}>
                <td>{item.fileName}</td>
                <td>{item.action}</td>
                <td className={item.outcome === 'done' ? undefined : styles.error}>
                  {item.outcome}
                </td>
                <td className={styles.muted}>{item.detail}</td>
                <td>
                  {item.outcome === 'conflict' && (
                    <ConflictButtons
                      disabled={busy}
                      onKeep={(keep) => resolve.mutate(toResolution(romId, item, keep))}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function toResolution(
  romId: number,
  item: SyncItemResult,
  keep: ConflictResolution['keep'],
): ConflictResolution {
  return { romId, kind: item.kind, fileName: item.fileName, keep };
}

function ConflictButtons(props: {
  disabled: boolean;
  onKeep: (keep: ConflictResolution['keep']) => void;
}) {
  return (
    <div className={styles.row}>
      <button
        className={styles.button}
        disabled={props.disabled}
        onClick={() => props.onKeep('local')}
      >
        Keep this PC&apos;s
      </button>
      <button
        className={styles.button}
        disabled={props.disabled}
        onClick={() => props.onKeep('server')}
      >
        Keep server&apos;s
      </button>
    </div>
  );
}
