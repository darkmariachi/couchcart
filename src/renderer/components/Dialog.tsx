import { useEffect, type ReactNode } from 'react';
import { useControls, type Controls } from '../input/controls';
import { focusFirst } from '../input/focus';
import { Focusable } from './Focusable';
import styles from './ui.module.css';

interface DialogProps {
  title: string;
  children: ReactNode;
  /** Buttons other than A; `back` usually closes the dialog. */
  controls?: Controls;
  level?: number;
}

/**
 * A modal layer: focus cannot leave it and the screen behind stops receiving buttons.
 * Focus returns to wherever it was when the dialog closes.
 */
export function Dialog({ title, children, controls = {}, level = 20 }: DialogProps) {
  useControls(controls, { level, modal: true });

  useEffect(() => {
    const previous = document.activeElement;
    focusFirst();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-label={title} data-focus-scope="">
        <h2 className={styles.dialogTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  run: () => void;
}

export function MenuDialog(props: { title: string; items: MenuItem[]; onClose: () => void }) {
  return (
    <Dialog title={props.title} controls={{ back: { label: 'Close', run: props.onClose } }}>
      {props.items.map((item) => (
        <Focusable
          key={item.label}
          className={styles.menuItem}
          onPress={() => {
            props.onClose();
            item.run();
          }}
        >
          {item.label}
        </Focusable>
      ))}
    </Dialog>
  );
}

export function MessageDialog(props: { title: string; message: string; onClose: () => void }) {
  return (
    <Dialog title={props.title} controls={{ back: { label: 'Close', run: props.onClose } }}>
      <p style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.5 }}>{props.message}</p>
      <div className={styles.row}>
        <Focusable variant="primary" onPress={props.onClose}>
          OK
        </Focusable>
      </div>
    </Dialog>
  );
}
