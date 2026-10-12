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
  /**
   * Completions for what has been typed so far. Choosing one submits it. Must keep the
   * same identity between renders (wrap it in useCallback), or it runs on every render.
   */
  suggest?: (typed: string) => string[] | Promise<string[]>;
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
  suggest,
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
      if (key === 'Enter') {
        // Enter on a highlighted suggestion picks it; anywhere else it submits the text.
        const focused = document.activeElement;
        const onSuggestion =
          focused instanceof HTMLElement && focused.classList.contains(styles.suggestion ?? '');
        if (onSuggestion) focused.click();
        else submitCurrent.current();
      } else if (key === 'Backspace') erase();
      else type(key);
    });
    return () => captureTextKeys(null);
  }, []);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!suggest) return;
    let stale = false;
    // A short pause, so a fast typist does not trigger a lookup per key.
    const timer = setTimeout(async () => {
      const found = await suggest(value);
      if (!stale) setSuggestions(found);
    }, 160);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [value, suggest]);

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

      {suggest && (
        // Always takes up its space, so the keys do not jump when suggestions appear.
        <div className={styles.suggestions}>
          {suggestions.map((suggestion) => (
            <Focusable
              key={suggestion}
              className={styles.suggestion}
              onPress={() => onSubmit(suggestion)}
            >
              {suggestion}
            </Focusable>
          ))}
          {suggestions.length === 0 && (
            <span className={styles.muted}>
              {value.trim().length < 2 ? 'Suggestions appear as you type' : 'No matching games'}
            </span>
          )}
        </div>
      )}

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
