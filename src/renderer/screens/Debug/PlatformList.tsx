import type { PlatformSummary } from '../../../shared/ipc';
import styles from './Debug.module.css';

interface Props {
  platforms: PlatformSummary[];
  selectedId: number | null;
  onSelect: (platformId: number) => void;
}

export function PlatformList({ platforms, selectedId, onSelect }: Props) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Platforms ({platforms.length})</h2>
      <ul className={styles.list}>
        {platforms.map((platform) => (
          <li key={platform.id}>
            <button
              className={`${styles.listItem} ${platform.id === selectedId ? styles.selected : ''}`}
              onClick={() => onSelect(platform.id)}
            >
              <span>{platform.name}</span>
              <span className={styles.muted}>{platform.romCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
