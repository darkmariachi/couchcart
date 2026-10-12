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

/** Shows what each controller button does on the current screen. */
export function Footer() {
  const hints = useHints();
  return (
    <footer className={styles.footer}>
      <span className={styles.hint}>
        <span className={styles.glyph}>A</span> Select
      </span>
      {hints.map((hint) => (
        <span key={hint.button} className={styles.hint}>
          <span className={styles.glyph}>{GLYPHS[hint.button]}</span> {hint.label}
        </span>
      ))}
    </footer>
  );
}
