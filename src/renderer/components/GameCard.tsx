import { useState } from 'react';
import type { RomSummary } from '../../shared/ipc';
import { Focusable } from './Focusable';
import styles from './ui.module.css';

/** Covers are served by the main process, which caches them on disk. */
export function coverUrl(path: string): string {
  return `romm-cover://cover/${encodeURIComponent(path)}`;
}

export function Cover({ path, title }: { path: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.cover}>
      {path && !failed ? (
        <img
          className={styles.coverImage}
          src={coverUrl(path)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.coverFallback}>{title}</div>
      )}
    </div>
  );
}

interface GameCardProps {
  rom: RomSummary;
  focusKey: string;
  preferred?: boolean;
  onOpen: (romId: number) => void;
}

export function GameCard({ rom, focusKey, preferred, onOpen }: GameCardProps) {
  return (
    <Focusable
      className={styles.card}
      focusKey={focusKey}
      preferred={preferred}
      onPress={() => onOpen(rom.id)}
    >
      <div style={{ position: 'relative' }}>
        <Cover path={rom.coverPath} title={rom.name} />
        {rom.downloaded && <span className={styles.badge}>On this PC</span>}
        {rom.syncStatus && rom.syncStatus !== 'synced' && (
          <span className={`${styles.badge} ${styles.warnBadge}`}>
            {rom.syncStatus === 'conflict' ? 'Save conflict' : 'Not synced'}
          </span>
        )}
      </div>
      <span className={styles.cardTitle}>{rom.name}</span>
    </Focusable>
  );
}
