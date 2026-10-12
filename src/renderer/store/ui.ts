import { create } from 'zustand';
import type { GridSource } from '../../shared/ipc';
import { focusedElement } from '../input/focus';

export type Route =
  | { name: 'home' }
  | { name: 'platforms' }
  | { name: 'collections' }
  /** `openKeyboard` starts typing straight away (when Search was chosen deliberately). */
  | { name: 'search'; openKeyboard?: boolean }
  /** A grid of games: one platform, one collection, or search results. */
  | { name: 'grid'; source: GridSource; title: string }
  | { name: 'game'; romId: number }
  | { name: 'settings' }
  | { name: 'downloads' }
  | { name: 'debug' };

interface StackEntry {
  route: Route;
  /** What was focused when the user left this screen, so "back" returns to it. */
  focusKey: string | null;
}

interface UiState {
  stack: StackEntry[];
  push: (route: Route) => void;
  /** Swaps the current screen without growing the history (e.g. LB/RB between platforms). */
  replace: (route: Route) => void;
  pop: () => void;
  /** Jumps to a top-level section, forgetting the history. */
  goTo: (route: Route) => void;
  reset: () => void;
}

const HOME: StackEntry = { route: { name: 'home' }, focusKey: null };

export const useUi = create<UiState>((set) => ({
  stack: [HOME],
  push: (route) =>
    set(({ stack }) => {
      const current = stack[stack.length - 1] ?? HOME;
      const focusKey = focusedElement()?.dataset['focusKey'] ?? null;
      return {
        stack: [...stack.slice(0, -1), { ...current, focusKey }, { route, focusKey: null }],
      };
    }),
  replace: (route) =>
    set(({ stack }) => ({ stack: [...stack.slice(0, -1), { route, focusKey: null }] })),
  // "Back" from a top-level section other than home goes home rather than nowhere.
  pop: () =>
    set(({ stack }) => {
      if (stack.length > 1) return { stack: stack.slice(0, -1) };
      return stack[0]?.route.name === 'home' ? { stack } : { stack: [HOME] };
    }),
  goTo: (route) => set({ stack: [{ route, focusKey: null }] }),
  reset: () => set({ stack: [HOME] }),
}));

export function useCurrentEntry(): StackEntry {
  return useUi((state) => state.stack[state.stack.length - 1] ?? HOME);
}

/** The top-level section the current screen belongs to, for highlighting the navigation. */
export function useSection(): Route['name'] {
  return useUi((state) => state.stack[0]?.route.name ?? 'home');
}
