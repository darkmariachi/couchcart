import { useQuery } from '@tanstack/react-query';
import type { PlatformSummary, RomSummary } from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { Focusable } from '../components/Focusable';
import { GameCard } from '../components/GameCard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { usePlatforms, useRecentlyPlayed } from '../hooks';
import { useCurrentEntry, useUi } from '../store/ui';
import styles from './screens.module.css';

const SHELF_SIZE = 18;

export function HomeScreen({ username }: { username: string | null }) {
  const push = useUi((state) => state.push);
  const entry = useCurrentEntry();
  const platforms = usePlatforms();
  const recent = useRecentlyPlayed();

  const openGame = (romId: number) => push({ name: 'game', romId });

  return (
    <Screen
      title="RomM Launcher"
      subtitle={username}
      ready={platforms.isSuccess && !recent.isPending}
      restoreFocusKey={entry.focusKey}
    >
      {platforms.isPending && <p className={ui.muted}>Loading your library…</p>}
      {platforms.isError && <p className={ui.error}>{errorMessage(platforms.error)}</p>}
      {platforms.data?.length === 0 && (
        <p className={ui.muted}>Your RomM library has no games yet.</p>
      )}

      {recent.data && recent.data.length > 0 && (
        <Shelf title="Continue playing" keyPrefix="recent" roms={recent.data} onOpen={openGame} />
      )}

      {platforms.data?.map((platform) => (
        <PlatformShelf
          key={platform.id}
          platform={platform}
          onOpenGame={openGame}
          onOpenPlatform={() => push({ name: 'platform', platformId: platform.id })}
        />
      ))}
    </Screen>
  );
}

function PlatformShelf(props: {
  platform: PlatformSummary;
  onOpenGame: (romId: number) => void;
  onOpenPlatform: () => void;
}) {
  const { platform } = props;
  const roms = useQuery({
    queryKey: ['library', 'shelf', platform.id],
    queryFn: () =>
      unwrap(window.romm.library.roms({ platformId: platform.id, offset: 0, limit: SHELF_SIZE })),
  });

  return (
    <Shelf
      title={`${platform.name} · ${platform.romCount}`}
      keyPrefix={`platform-${platform.id}`}
      roms={roms.data?.items ?? []}
      onOpen={props.onOpenGame}
    >
      <div className={styles.shelfItem}>
        <Focusable
          className={styles.moreCard}
          focusKey={`platform-${platform.id}-all`}
          onPress={props.onOpenPlatform}
        >
          All {platform.romCount} games
        </Focusable>
      </div>
    </Shelf>
  );
}

function Shelf(props: {
  title: string;
  /** The same game can sit on two shelves, so focus keys are scoped per shelf. */
  keyPrefix: string;
  roms: RomSummary[];
  onOpen: (romId: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{props.title}</h2>
      <div className={styles.shelf}>
        {props.roms.map((rom) => (
          <div key={rom.id} className={styles.shelfItem}>
            <GameCard rom={rom} focusKey={`${props.keyPrefix}-${rom.id}`} onOpen={props.onOpen} />
          </div>
        ))}
        {props.children}
      </div>
    </section>
  );
}
