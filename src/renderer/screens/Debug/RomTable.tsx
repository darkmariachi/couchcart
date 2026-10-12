import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PlatformSummary } from '../../../shared/ipc';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

const PAGE_SIZE = 25;

interface Props {
  platform: PlatformSummary;
  selectedRomId: number | null;
  onSelect: (romId: number) => void;
}

export function RomTable({ platform, selectedRomId, onSelect }: Props) {
  const [offset, setOffset] = useState(0);

  const roms = useQuery({
    queryKey: ['roms', platform.id, offset],
    queryFn: () =>
      unwrap(window.romm.library.roms({ platformId: platform.id, offset, limit: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });

  const total = roms.data?.total ?? 0;
  const lastShown = Math.min(offset + PAGE_SIZE, total);

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        {platform.name} games ({total})
      </h2>
      {roms.isError && <p className={styles.error}>{errorMessage(roms.error)}</p>}
      {roms.isPending && <p className={styles.muted}>Loading…</p>}
      {roms.data && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>File</th>
                <th>Size</th>
                <th>Last played</th>
              </tr>
            </thead>
            <tbody>
              {roms.data.items.map((rom) => (
                <tr
                  key={rom.id}
                  className={`${styles.clickableRow} ${rom.id === selectedRomId ? styles.selected : ''}`}
                  onClick={() => onSelect(rom.id)}
                >
                  <td>{rom.id}</td>
                  <td>{rom.name}</td>
                  <td className={styles.muted}>{rom.fileName}</td>
                  <td>{formatSize(rom.sizeBytes)}</td>
                  <td>{rom.lastPlayed ? new Date(rom.lastPlayed).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.row} style={{ marginTop: 12 }}>
            <button
              className={styles.button}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              Previous
            </button>
            <button
              className={styles.button}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={lastShown >= total}
            >
              Next
            </button>
            <span className={styles.muted}>
              {total === 0 ? 'No games' : `${offset + 1}–${lastShown} of ${total}`}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function formatSize(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
