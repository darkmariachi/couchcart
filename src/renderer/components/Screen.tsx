import { useEffect, type ReactNode } from 'react';
import { focusByKey, focusFirst, focusedElement } from '../input/focus';
import styles from './ui.module.css';

interface ScreenProps {
  title: string;
  subtitle?: ReactNode;
  /** Shown before the title, e.g. a platform icon. */
  leading?: ReactNode;
  children: ReactNode;
  /** Set once the screen's content is rendered, so there is something to focus. */
  ready?: boolean;
  /** Element to return focus to, when coming back to this screen. */
  restoreFocusKey?: string | null;
  /** Image for the blurred background while anything on this screen has focus. */
  ambient?: string | null;
}

export function Screen({
  title,
  subtitle,
  leading,
  children,
  ready = true,
  restoreFocusKey,
  ambient,
}: ScreenProps) {
  useEffect(() => {
    if (!ready || focusedElement()?.closest('[data-screen]')) return;
    if (!restoreFocusKey || !focusByKey(restoreFocusKey)) focusFirst();
  }, [ready, restoreFocusKey]);

  return (
    <div className={styles.screen} data-screen="" data-ambient={ambient ?? undefined}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          {leading}
          <h1 className={styles.title}>{title}</h1>
        </div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </header>
      <div className={styles.content} data-scroll-container="">
        {children}
      </div>
    </div>
  );
}
