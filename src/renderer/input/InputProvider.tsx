import { useEffect, type ReactNode } from 'react';
import { dispatchAction, getTextKeyListener, type Action } from './controls';

const KEYBOARD: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'accept',
  Escape: 'back',
  Backspace: 'back',
  x: 'x',
  y: 'y',
  q: 'lb',
  PageUp: 'lb',
  e: 'rb',
  PageDown: 'rb',
  F1: 'start',
};

// Indices of the W3C "standard" gamepad mapping, which is what Xbox-style pads report.
const GAMEPAD_BUTTONS: [number, Action][] = [
  [0, 'accept'],
  [1, 'back'],
  [2, 'x'],
  [3, 'y'],
  [4, 'lb'],
  [5, 'rb'],
  [9, 'start'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const DIRECTIONS = new Set<Action>(['up', 'down', 'left', 'right']);
const STICK_THRESHOLD = 0.55;
const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 110;

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  // A real text field (only the debug screen has them) keeps its normal typing behaviour.
  if (event.target instanceof HTMLInputElement) return;

  const textListener = getTextKeyListener();
  const isTextKey = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter';
  if (textListener && isTextKey) {
    event.preventDefault();
    textListener(event.key);
    return;
  }

  const action = KEYBOARD[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  // Otherwise arrows would scroll the page and Enter would click the button a second time.
  event.preventDefault();
  dispatchAction(action);
}

function pressedActions(pad: Gamepad): Set<Action> {
  const pressed = new Set<Action>();
  for (const [index, action] of GAMEPAD_BUTTONS) {
    if (pad.buttons[index]?.pressed) pressed.add(action);
  }
  const [x = 0, y = 0] = pad.axes;
  if (x <= -STICK_THRESHOLD) pressed.add('left');
  if (x >= STICK_THRESHOLD) pressed.add('right');
  if (y <= -STICK_THRESHOLD) pressed.add('up');
  if (y >= STICK_THRESHOLD) pressed.add('down');
  return pressed;
}

/** Polls gamepads once per frame; returns a function that stops the polling. */
function startGamepadPolling(): () => void {
  // For each held action, when it should fire next (directions repeat, buttons do not).
  const held = new Map<Action, number>();
  let frame = 0;

  const poll = (now: number) => {
    frame = requestAnimationFrame(poll);
    // A game running in RetroArch uses the same controller; do not react to it here.
    if (!document.hasFocus()) {
      held.clear();
      return;
    }

    const pressed = new Set<Action>();
    for (const pad of navigator.getGamepads()) {
      if (pad?.connected) pressedActions(pad).forEach((action) => pressed.add(action));
    }

    for (const action of held.keys()) {
      if (!pressed.has(action)) held.delete(action);
    }
    for (const action of pressed) {
      const nextAt = held.get(action);
      if (nextAt === undefined) {
        held.set(action, now + REPEAT_DELAY_MS);
        dispatchAction(action);
      } else if (DIRECTIONS.has(action) && now >= nextAt) {
        held.set(action, now + REPEAT_INTERVAL_MS);
        dispatchAction(action);
      }
    }
  };

  frame = requestAnimationFrame(poll);
  return () => cancelAnimationFrame(frame);
}

/** Turns keyboard and gamepad input into actions for the whole app. */
export function InputProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    const stopPolling = startGamepadPolling();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopPolling();
    };
  }, []);

  return children;
}
