import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import styles from './ui.module.css';

// Names for the W3C "standard" gamepad layout, in button-index order.
const BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Back',
  'Start',
  'L3',
  'R3',
  'Up',
  'Down',
  'Left',
  'Right',
  'Guide',
];
const HOLD_TO_CLOSE_MS = 1000;
const CLOSE_BUTTON = 1; // B

interface PadSnapshot {
  name: string;
  pressed: boolean[];
  axes: number[];
}

/**
 * Shows live what each connected controller is sending, for working out why one is not
 * responding. This is what the launcher sees; a game sees the controller through RetroArch
 * (Settings → Controllers shows that side).
 *
 * Every button has to be testable, so none of them can close the dialog with a press:
 * holding B does.
 */
export function ControllerTest({ onClose }: { onClose: () => void }) {
  const [pads, setPads] = useState<PadSnapshot[]>([]);

  useEffect(() => {
    let frame = 0;
    let heldSince: number | null = null;

    const poll = (now: number) => {
      frame = requestAnimationFrame(poll);
      const connected = [...navigator.getGamepads()].filter((pad) => pad?.connected);

      const closing = connected.some((pad) => pad?.buttons[CLOSE_BUTTON]?.pressed);
      heldSince = closing ? (heldSince ?? now) : null;
      if (heldSince !== null && now - heldSince >= HOLD_TO_CLOSE_MS) {
        onClose();
        return;
      }

      setPads(
        connected.map((pad) => ({
          name: pad?.id ?? 'Controller',
          pressed: pad?.buttons.map((button) => button.pressed) ?? [],
          axes: pad?.axes.map((value) => Math.round(value * 100) / 100) ?? [],
        })),
      );
    };
    frame = requestAnimationFrame(poll);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    // No button controls: presses are shown, not acted on.
    <Dialog title="Controller test" level={40}>
      {pads.length === 0 && (
        <p className={styles.dialogText}>
          No controller detected yet. Press any button on it: a controller only shows up after its
          first button press.
        </p>
      )}
      {pads.map((pad, index) => (
        <div key={index} className={styles.widget}>
          <h3 className={styles.widgetTitle}>{pad.name}</h3>
          <div className={styles.row}>
            {pad.pressed.map((isPressed, button) => (
              <span key={button} className={`${styles.pill} ${isPressed ? styles.pillActive : ''}`}>
                {BUTTON_NAMES[button] ?? `Button ${button}`}
              </span>
            ))}
          </div>
          <p className={styles.note} style={{ padding: 0, marginBottom: 0 }}>
            Left stick {formatStick(pad.axes[0], pad.axes[1])} · Right stick{' '}
            {formatStick(pad.axes[2], pad.axes[3])}
          </p>
        </div>
      ))}
      <p className={styles.muted}>Hold B for one second to close (or press Esc).</p>
    </Dialog>
  );
}

function formatStick(x = 0, y = 0): string {
  return `${x.toFixed(2)}, ${y.toFixed(2)}`;
}
