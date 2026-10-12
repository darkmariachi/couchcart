import { useEffect, type ReactNode } from 'react';
import { focusByKey, focusFirst, focusedElement } from '../input/focus';
import styles from './ui.module.css';

interface ScreenProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Set once the screen's content is rendered, so there is something to focus. */
  ready?: boolean;
  /** Element to return focus to, when coming back to this screen. */
  restoreFocusKey?: string | null;
}

export function Screen({ title, subtitle, children, ready = true, restoreFocusKey }: ScreenProps) {
  useEffect(() => {
    if (!ready || focusedElement()) return;
    if (!restoreFocusKey || !focusByKey(restoreFocusKey)) focusFirst();
  }, [ready, restoreFocusKey]);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
