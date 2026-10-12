import { useDownloads, useOnline } from '../hooks';
import { useHints, type ControlButton } from '../input/controls';
import styles from './ui.module.css';

const GLYPHS: Record<ControlButton, string> = {
  back: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  start: '☰',
};

/** Floats over the bottom of every screen: connection and download status, button hints. */
export function Footer() {
  const hints = useHints();
  const online = useOnline();
  const active = useDownloads().filter(
    (job) => job.status === 'queued' || job.status === 'downloading',
  );
  const current = active.find((job) => job.status === 'downloading');
  const percent = current?.totalBytes
    ? Math.round((current.receivedBytes / current.totalBytes) * 100)
    : 0;

  return (
    <footer className={styles.footer}>
      <div className={styles.footerStatus}>
        {!online && <span className={styles.chip}>Offline · showing your saved library</span>}
        {active.length > 0 && (
          <span className={styles.chip}>
            Downloading{' '}
            {active.length === 1 ? (current?.name ?? '1 game') : `${active.length} games`}
            {current ? ` · ${percent}%` : ''}
          </span>
        )}
      </div>
      <div className={styles.hints}>
        <span className={styles.hint}>
          <span className={styles.glyph}>A</span> Select
        </span>
        {hints.map((hint) => (
          <span key={hint.button} className={styles.hint}>
            <span className={styles.glyph}>{GLYPHS[hint.button]}</span> {hint.label}
          </span>
        ))}
      </div>
    </footer>
  );
}
