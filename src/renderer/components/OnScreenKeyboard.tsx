import { useEffect, useRef, useState } from 'react';
import { captureTextKeys } from '../input/controls';
import { Dialog } from './Dialog';
import { Focusable } from './Focusable';
import styles from './ui.module.css';

const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', '-_.:/@#&+=', '!?$%*()[]', '\'",;~^<>'];

interface OnScreenKeyboardProps {
  title: string;
  initialValue: string;
  /** Shows dots instead of the text. */
  secret?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Text entry for a controller. A physical keyboard can type straight into it as well, so
 * the app needs no separate text fields.
 */
export function OnScreenKeyboard({
  title,
  initialValue,
  secret,
  onSubmit,
  onCancel,
}: OnScreenKeyboardProps) {
  const [value, setValue] = useState(initialValue);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);

  const type = (character: string) => setValue((current) => current + character);
  const erase = () => setValue((current) => current.slice(0, -1));

  // The key listener is installed once, so it reads the latest value through a ref.
  const submitCurrent = useRef(() => onSubmit(value));
  useEffect(() => {
    submitCurrent.current = () => onSubmit(value);
  });

  useEffect(() => {
    captureTextKeys((key) => {
      if (key === 'Enter') submitCurrent.current();
      else if (key === 'Backspace') erase();
      else type(key);
    });
    return () => captureTextKeys(null);
  }, []);

  const rows = symbols ? SYMBOLS : LETTERS;
  return (
    <Dialog
      title={title}
      level={30}
      controls={{
        back: { label: 'Cancel', run: onCancel },
        x: { label: 'Delete', run: erase },
        y: { label: 'Space', run: () => type(' ') },
        start: { label: 'Done', run: () => onSubmit(value) },
      }}
    >
      <div className={styles.keyboardValue}>
        {secret ? '•'.repeat(value.length) : value}
        <span className={styles.caret} />
      </div>

      {rows.map((row, rowIndex) => (
        <div key={row} className={styles.keyRow}>
          {[...row].map((character, index) => {
            const key = shift ? character.toUpperCase() : character;
            return (
              <Focusable
                key={character}
                className={styles.key}
                preferred={rowIndex === 1 && index === 0}
                onPress={() => type(key)}
              >
                {key}
              </Focusable>
            );
          })}
        </div>
      ))}

      <div className={styles.keyRow}>
        <Focusable className={`${styles.key} ${styles.wideKey}`} onPress={() => setShift(!shift)}>
          {shift ? 'abc' : 'ABC'}
        </Focusable>
        <Focusable
          className={`${styles.key} ${styles.wideKey}`}
          onPress={() => setSymbols(!symbols)}
        >
          {symbols ? 'Letters' : '#+='}
        </Focusable>
        <Focusable className={`${styles.key} ${styles.wideKey}`} onPress={() => type(' ')}>
          Space
        </Focusable>
        <Focusable className={`${styles.key} ${styles.wideKey}`} onPress={erase}>
          Delete
        </Focusable>
        <Focusable
          className={`${styles.key} ${styles.wideKey}`}
          variant="primary"
          onPress={() => onSubmit(value)}
        >
          Done
        </Focusable>
      </div>
    </Dialog>
  );
}
