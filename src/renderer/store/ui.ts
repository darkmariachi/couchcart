import { create } from 'zustand';
import { focusedElement } from '../input/focus';

export type Route =
  | { name: 'home' }
  | { name: 'platform'; platformId: number }
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
  pop: () => set(({ stack }) => (stack.length > 1 ? { stack: stack.slice(0, -1) } : { stack })),
  reset: () => set({ stack: [HOME] }),
}));

export function useCurrentEntry(): StackEntry {
  return useUi((state) => state.stack[state.stack.length - 1] ?? HOME);
}
