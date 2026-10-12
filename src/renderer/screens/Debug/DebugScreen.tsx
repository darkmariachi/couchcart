import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, unwrap } from '../../api';
import { ApiProbePanel } from './ApiProbePanel';
import styles from './Debug.module.css';
import { LoginPanel } from './LoginPanel';
import { PlatformList } from './PlatformList';
import { PlayPanel } from './PlayPanel';
import { RetroArchPanel } from './RetroArchPanel';
import { RomAssetsPanel } from './RomAssetsPanel';
import { RomTable } from './RomTable';

const DEFAULT_PLATFORM_SLUG = 'n64';

export function DebugScreen() {
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: () => unwrap(window.romm.auth.status()),
    staleTime: 0,
  });

  const logout = useMutation({
    mutationFn: () => unwrap(window.romm.auth.logout()),
    onSuccess: (status) => {
      queryClient.clear();
      queryClient.setQueryData(['auth'], status);
    },
  });

  if (auth.isPending) return <main className={styles.screen}>Starting…</main>;
  if (auth.isError) {
    return <main className={`${styles.screen} ${styles.error}`}>{errorMessage(auth.error)}</main>;
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>RomM Launcher · API debug</h1>
        {auth.data.loggedIn && (
          <div className={styles.row}>
            <span className={styles.muted}>
              {auth.data.username} @ {auth.data.serverUrl}
            </span>
            <button className={styles.button} onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
        )}
      </header>
      {auth.data.loggedIn ? <Library /> : <LoginPanel status={auth.data} />}
    </main>
  );
}

function Library() {
  const [chosenPlatformId, setChosenPlatformId] = useState<number | null>(null);
  const [selectedRomId, setSelectedRomId] = useState<number | null>(null);

  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: () => unwrap(window.romm.library.platforms()),
  });

  if (platforms.isPending) return <p className={styles.muted}>Loading platforms…</p>;
  if (platforms.isError) return <p className={styles.error}>{errorMessage(platforms.error)}</p>;

  const platform =
    platforms.data.find((candidate) => candidate.id === chosenPlatformId) ??
    platforms.data.find((candidate) => candidate.slug === DEFAULT_PLATFORM_SLUG) ??
    platforms.data[0];

  const selectPlatform = (platformId: number) => {
    setChosenPlatformId(platformId);
    setSelectedRomId(null);
  };

  return (
    <div className={styles.columns}>
      <div className={styles.stack}>
        <PlatformList
          platforms={platforms.data}
          selectedId={platform?.id ?? null}
          onSelect={selectPlatform}
        />
        <RetroArchPanel />
        <ApiProbePanel />
      </div>
      <div className={styles.stack}>
        {platform ? (
          // Keyed so paging restarts from the first page when the platform changes.
          <RomTable
            key={platform.id}
            platform={platform}
            selectedRomId={selectedRomId}
            onSelect={setSelectedRomId}
          />
        ) : (
          <p className={styles.muted}>This RomM library has no games yet.</p>
        )}
        {selectedRomId !== null && (
          <>
            <PlayPanel romId={selectedRomId} />
            <RomAssetsPanel romId={selectedRomId} />
          </>
        )}
      </div>
    </div>
  );
}
