import type { ReactNode } from 'react';
import styles from './ui.module.css';

interface FocusableProps {
  onPress: () => void;
  children: ReactNode;
  /** Stable name used to return focus here when the user comes back to the screen. */
  focusKey?: string;
  /** Gets focus first when the screen opens. */
  preferred?: boolean;
  disabled?: boolean;
  className?: string;
  variant?: 'plain' | 'button' | 'primary';
}

/** Anything the controller can land on. A press is "A", Enter or a mouse click. */
export function Focusable({
  onPress,
  children,
  focusKey,
  preferred,
  disabled,
  className,
  variant = 'plain',
}: FocusableProps) {
  const classes = [
    styles.focusable,
    variant !== 'plain' && styles.button,
    variant === 'primary' && styles.primary,
    className,
  ];
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      data-focusable=""
      data-focus-key={focusKey}
      data-focus-default={preferred ? '' : undefined}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
}
