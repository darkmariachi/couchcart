import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LaunchState } from '../shared/ipc';
import { unwrap } from './api';

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => unwrap(window.romm.auth.status()),
    staleTime: 0,
  });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup'],
    queryFn: () => unwrap(window.romm.setup.status()),
    staleTime: 0,
  });
}

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => unwrap(window.romm.library.platforms()),
  });
}

export function usePlatformRoms(platformId: number) {
  return useQuery({
    queryKey: ['library', 'platform', platformId],
    queryFn: () => unwrap(window.romm.library.platformRoms(platformId)),
  });
}

export function useRecentlyPlayed() {
  return useQuery({
    queryKey: ['library', 'recent'],
    queryFn: () => unwrap(window.romm.library.recentlyPlayed()),
  });
}

export function useRomDetail(romId: number) {
  return useQuery({
    queryKey: ['library', 'rom', romId],
    queryFn: () => unwrap(window.romm.library.romDetail(romId)),
    staleTime: 0,
  });
}

/** Live download/launch state, pushed from the main process. */
export function useLaunchState(): LaunchState {
  const [state, setState] = useState<LaunchState>({ phase: 'idle' });

  useEffect(() => {
    void window.romm.game.state().then((result) => {
      if (result.ok) setState(result.value);
    });
    return window.romm.game.onStateChanged(setState);
  }, []);

  return state;
}

/**
 * Download status, last played and sync status all change when a game session or a
 * download ends, so library data is refetched at those moments.
 */
export function useRefreshLibraryAfterActivity(state: LaunchState): void {
  const queryClient = useQueryClient();
  const settled = state.phase === 'exited' || state.phase === 'idle' || state.phase === 'failed';
  useEffect(() => {
    if (settled) void queryClient.invalidateQueries({ queryKey: ['library'] });
  }, [settled, queryClient]);
}
