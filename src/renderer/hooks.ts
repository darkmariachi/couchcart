import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DownloadJob, GridSource, LaunchState, UpdateState } from '../shared/ipc';
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

/** Every game of a platform, a collection or a search. */
export function useGridRoms(source: GridSource) {
  return useQuery({
    queryKey: ['library', 'grid', source],
    queryFn: () => unwrap(window.romm.library.gridRoms(source)),
  });
}

export function useRecentlyAdded() {
  return useQuery({
    queryKey: ['library', 'recentlyAdded'],
    queryFn: () => unwrap(window.romm.library.recentlyAdded()),
  });
}

export function useCollections() {
  return useQuery({
    queryKey: ['library', 'collections'],
    queryFn: () => unwrap(window.romm.library.collections()),
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

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(window.romm.settings.get()),
    staleTime: 0,
  });
}

export function useControllers() {
  return useQuery({
    queryKey: ['controllers'],
    queryFn: () => unwrap(window.romm.controllers.list()),
    staleTime: 0,
  });
}

/** The download queue, kept current by events from the main process. */
export function useDownloads(): DownloadJob[] {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);

  useEffect(() => {
    void window.romm.downloads.list().then((result) => {
      if (result.ok) setJobs(result.value);
    });
    return window.romm.downloads.onChanged(setJobs);
  }, []);

  return jobs;
}

/** False while the RomM server cannot be reached and the app shows remembered data. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void window.romm.app.online().then((result) => {
      if (result.ok) setOnline(result.value);
    });
    return window.romm.app.onOnlineChanged(setOnline);
  }, []);

  return online;
}

/** What is known about newer versions of the app; null until the main process answers. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    void window.romm.updates.state().then((result) => {
      if (result.ok) setState(result.value);
    });
    return window.romm.updates.onChanged(setState);
  }, []);

  return state;
}

/**
 * Asks RetroArch to look for controllers again whenever one is plugged in or removed,
 * so the next game starts with the right controller as player 1.
 */
export function useControllerRedetection(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redetect = () => {
      clearTimeout(timer);
      // Several events arrive in a burst when a controller connects.
      timer = setTimeout(() => {
        void window.romm.controllers
          .detect()
          .then(() => queryClient.invalidateQueries({ queryKey: ['controllers'] }));
      }, 1500);
    };
    window.addEventListener('gamepadconnected', redetect);
    window.addEventListener('gamepaddisconnected', redetect);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('gamepadconnected', redetect);
      window.removeEventListener('gamepaddisconnected', redetect);
    };
  }, [queryClient]);
}
