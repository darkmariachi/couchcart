import { useState } from 'react';
import styles from '../screens/screens.module.css';
import { Focusable } from './Focusable';
import { OnScreenKeyboard } from './OnScreenKeyboard';
import ui from './ui.module.css';

/** A value the user edits with the on-screen keyboard. */
export function Field(props: {
  label: string;
  value: string;
  secret?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const shown = props.secret ? '•'.repeat(props.value.length) : props.value;
  return (
    <>
      <Focusable className={styles.field} onPress={() => setEditing(true)}>
        <span className={styles.fieldLabel}>{props.label}</span>
        <span className={`${styles.fieldValue} ${shown ? '' : ui.muted}`}>
          {shown || props.placeholder || 'Press A to enter'}
        </span>
      </Focusable>
      {editing && (
        <OnScreenKeyboard
          title={props.label}
          initialValue={props.value}
          secret={props.secret}
          onCancel={() => setEditing(false)}
          onSubmit={(value) => {
            props.onChange(value);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
