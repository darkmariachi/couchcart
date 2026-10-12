import type { ReactNode } from 'react';
import { mdiBookmark, mdiController, mdiPlay, mdiStarFourPoints } from '@mdi/js';
import type { RomSummary } from '../../shared/ipc';
import { errorMessage } from '../api';
import { CollectionCard, GameCard, PlatformCard } from '../components/GameCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { useCollections, usePlatforms, useRecentlyAdded, useRecentlyPlayed } from '../hooks';
import { useCurrentEntry, useUi } from '../store/ui';
import styles from './screens.module.css';

export function HomeScreen() {
  const push = useUi((state) => state.push);
  const entry = useCurrentEntry();
  const platforms = usePlatforms();
  const collections = useCollections();
  const recentlyPlayed = useRecentlyPlayed();
  const recentlyAdded = useRecentlyAdded();

  const openGame = (romId: number) => push({ name: 'game', romId });
  const totalGames = platforms.data?.reduce((total, platform) => total + platform.romCount, 0);
  const favorites = collections.data?.find((collection) => collection.isFavorites);

  return (
    <Screen
      title="Home"
      ready={platforms.isSuccess && !recentlyPlayed.isPending && !recentlyAdded.isPending}
      restoreFocusKey={entry.focusKey}
    >
      {platforms.isPending && <p className={ui.muted}>Loading your library…</p>}
      {platforms.isError && <p className={ui.error}>{errorMessage(platforms.error)}</p>}
      {platforms.data?.length === 0 && (
        <p className={ui.muted}>Your RomM library has no games yet.</p>
      )}

      {platforms.data && platforms.data.length > 0 && (
        <div className={styles.stats}>
          <Stat value={totalGames ?? 0} label="Games" />
          <Stat value={platforms.data.length} label="Platforms" />
          {collections.data && <Stat value={collections.data.length} label="Collections" />}
          {favorites && <Stat value={favorites.romCount} label="Favourites" />}
        </div>
      )}

      {recentlyPlayed.data && recentlyPlayed.data.length > 0 && (
        <Section icon={mdiPlay} title="Continue playing" count={recentlyPlayed.data.length}>
          <GameShelf prefix="recent" roms={recentlyPlayed.data} onOpen={openGame} />
        </Section>
      )}

      {recentlyAdded.data && recentlyAdded.data.length > 0 && (
        <Section icon={mdiStarFourPoints} title="Recently added" count={recentlyAdded.data.length}>
          <GameShelf prefix="added" roms={recentlyAdded.data} onOpen={openGame} />
        </Section>
      )}

      {platforms.data && platforms.data.length > 0 && (
        <Section icon={mdiController} title="Platforms" count={platforms.data.length}>
          {platforms.data.map((platform) => (
            <div key={platform.id} className={styles.shelfTile}>
              <PlatformCard
                platform={platform}
                focusKey={`home-platform-${platform.id}`}
                onOpen={() =>
                  push({
                    name: 'grid',
                    title: platform.name,
                    source: { type: 'platform', platformId: platform.id },
                  })
                }
              />
            </div>
          ))}
        </Section>
      )}

      {collections.data && collections.data.length > 0 && (
        <Section icon={mdiBookmark} title="Collections" count={collections.data.length}>
          {collections.data.map((collection) => (
            <div key={`${collection.kind}-${collection.id}`} className={styles.shelfTile}>
              <CollectionCard
                collection={collection}
                focusKey={`home-collection-${collection.kind}-${collection.id}`}
                onOpen={() =>
                  push({
                    name: 'grid',
                    title: collection.name,
                    source: { type: 'collection', kind: collection.kind, id: collection.id },
                  })
                }
              />
            </div>
          ))}
        </Section>
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={`${ui.widget} ${styles.stat}`}>
      <span className={styles.statValue}>{value.toLocaleString()}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function Section(props: { icon: string; title: string; count: number; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeader}>
        <Icon path={props.icon} />
        {props.title}
        <span className={ui.pill}>{props.count}</span>
      </h2>
      <div className={styles.shelf}>{props.children}</div>
    </section>
  );
}

/** The same game can sit on two shelves, so focus keys are scoped by `prefix`. */
function GameShelf(props: { prefix: string; roms: RomSummary[]; onOpen: (romId: number) => void }) {
  return props.roms.map((rom) => (
    <div key={rom.id} className={styles.shelfItem}>
      <GameCard
        rom={rom}
        focusKey={`${props.prefix}-${rom.id}`}
        showPlatform
        onOpen={props.onOpen}
      />
    </div>
  ));
}
