import { useEffect, useState } from 'react';
import { assetUrl } from '../assets';
import styles from './ui.module.css';

interface AmbientState {
  /** Two layers, so the new image can fade in over the old one. */
  layers: [string | null, string | null];
  front: 0 | 1;
}

/**
 * The blurred artwork behind the whole UI, as in RomM. It follows focus: whatever is
 * focused (or a parent of it) can name an image with `data-ambient`, and the background
 * cross-fades to it.
 */
export function Ambient() {
  const [state, setState] = useState<AmbientState>({ layers: [null, null], front: 0 });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: string | null = null;

    const onFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const path = target?.closest<HTMLElement>('[data-ambient]')?.dataset['ambient'];
      if (!path || path === shown) return;

      // Moving quickly across a grid should not load an image for every card passed.
      clearTimeout(timer);
      timer = setTimeout(() => {
        shown = path;
        setState((previous) => {
          const front = previous.front === 0 ? 1 : 0;
          const layers: AmbientState['layers'] = [...previous.layers];
          layers[front] = path;
          return { layers, front };
        });
      }, 220);
    };

    document.addEventListener('focusin', onFocus);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);

  return (
    <div className={styles.ambient} aria-hidden="true">
      {state.layers.map((path, index) => (
        <div
          key={index}
          className={`${styles.ambientLayer} ${index === state.front && path ? styles.ambientVisible : ''}`}
          style={path ? { backgroundImage: `url("${assetUrl(path)}")` } : undefined}
        />
      ))}
      <div className={styles.ambientOverlay} />
    </div>
  );
}
