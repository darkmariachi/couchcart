import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { focusedElement, moveFocus } from './focus';

export type Action =
  'up' | 'down' | 'left' | 'right' | 'accept' | 'back' | 'x' | 'y' | 'lb' | 'rb' | 'start';

/** Buttons a screen can give a meaning to. Directions and A always move and select. */
export type ControlButton = 'back' | 'x' | 'y' | 'lb' | 'rb' | 'start';

export interface Control {
  label: string;
  run: () => void;
}

export type Controls = Partial<Record<ControlButton, Control>>;

export interface Hint {
  button: ControlButton;
  label: string;
}

interface Layer {
  id: string;
  level: number;
  /** A modal layer hides the controls of everything beneath it. */
  modal: boolean;
  getControls: () => Controls;
  labels: string;
}

// Screens and dialogs register their controls as layers. The highest layer that defines a
// button handles it, which is how a dialog takes over "B" from the screen behind it.
let layers: Layer[] = [];
let hints: Hint[] = [];
const listeners = new Set<() => void>();
const BUTTON_ORDER: ControlButton[] = ['back', 'x', 'y', 'lb', 'rb', 'start'];

function activeLayers(): Layer[] {
  const ordered = [...layers].sort((a, b) => b.level - a.level);
  const modalIndex = ordered.findIndex((layer) => layer.modal);
  return modalIndex === -1 ? ordered : ordered.slice(0, modalIndex + 1);
}

function setLayers(next: Layer[]): void {
  layers = next;
  const active = activeLayers();
  hints = BUTTON_ORDER.flatMap((button) => {
    const control = active.map((layer) => layer.getControls()[button]).find(Boolean);
    return control ? [{ button, label: control.label }] : [];
  });
  listeners.forEach((listener) => listener());
}

/**
 * Declares what the extra buttons do while the calling component is mounted.
 * `level` orders overlapping declarations: app shell 0, screens 10, dialogs 20 and up.
 */
export function useControls(
  controls: Controls,
  { level, modal = false }: { level: number; modal?: boolean },
): void {
  const id = useId();
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });

  // Only the labels are shown in the footer, so only a label change needs a re-register.
  const labels = BUTTON_ORDER.map((button) => controls[button]?.label ?? '').join('|');
  useEffect(() => {
    const layer: Layer = { id, level, modal, labels, getControls: () => latest.current };
    setLayers([...layers.filter((existing) => existing.id !== id), layer]);
    return () => setLayers(layers.filter((existing) => existing.id !== id));
  }, [id, level, modal, labels]);
}

export function useHints(): Hint[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hints,
  );
}

/** Entry point for every input device: keyboard and gamepad both end up here. */
export function dispatchAction(action: Action): void {
  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      moveFocus(action);
      return;
    case 'accept':
      focusedElement()?.click();
      return;
    default:
      activeLayers()
        .map((layer) => layer.getControls()[action])
        .find(Boolean)
        ?.run();
  }
}

type TextKeyListener = (key: string) => void;
let textKeyListener: TextKeyListener | null = null;

/**
 * While set, typing on a physical keyboard goes to the listener (the on-screen keyboard)
 * instead of being read as shortcuts.
 */
export function captureTextKeys(listener: TextKeyListener | null): void {
  textKeyListener = listener;
}

export function getTextKeyListener(): TextKeyListener | null {
  return textKeyListener;
}
