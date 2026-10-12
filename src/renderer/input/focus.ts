import { pickNext, type Direction } from './spatial';

// Focus is plain DOM focus on elements marked `data-focusable`. Styling, the keyboard and
// the mouse therefore all work without a parallel notion of "selected".
const FOCUSABLE = '[data-focusable]:not(:disabled)';

/**
 * The innermost open layer (a dialog or menu) keeps focus inside itself: it is the last
 * `data-focus-scope` element in the document. Without one, the whole page is the scope.
 */
function currentScope(): ParentNode {
  const scopes = document.querySelectorAll('[data-focus-scope]');
  return scopes[scopes.length - 1] ?? document;
}

function focusables(): HTMLElement[] {
  return [...currentScope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
}

function focus(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

export function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches(FOCUSABLE)) return null;
  // Something focused behind an open dialog does not count: "A" must not press it.
  const scope = currentScope();
  return scope === document || scope.contains(active) ? active : null;
}

/** Focuses the preferred element of the current scope, or simply its first one. */
export function focusFirst(): boolean {
  const all = focusables();
  const target = all.find((element) => element.hasAttribute('data-focus-default')) ?? all[0];
  if (target) focus(target);
  return target !== undefined;
}

export function focusByKey(key: string): boolean {
  const target = focusables().find((element) => element.dataset['focusKey'] === key);
  if (target) focus(target);
  return target !== undefined;
}

export function moveFocus(direction: Direction): void {
  const all = focusables();
  const current = focusedElement();
  if (!current || !all.includes(current)) {
    focusFirst();
    return;
  }

  const candidates = all
    .filter((element) => element !== current)
    .map((element) => ({ element, box: element.getBoundingClientRect() }));
  const next = pickNext(current.getBoundingClientRect(), candidates, direction);
  if (next) focus(next.element);
}
