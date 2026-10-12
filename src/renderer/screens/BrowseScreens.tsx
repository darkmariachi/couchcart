import { errorMessage } from '../api';
import { CollectionCard, PlatformCard } from '../components/GameCard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { useCollections, usePlatforms } from '../hooks';
import { useControls } from '../input/controls';
import { useCurrentEntry, useUi } from '../store/ui';
import styles from './screens.module.css';

/** All platforms that have games. */
export function PlatformsScreen() {
  const { push, pop } = useUi();
  const entry = useCurrentEntry();
  const platforms = usePlatforms();
  useControls({ back: { label: 'Home', run: pop } }, { level: 10 });

  return (
    <Screen
      title="Platforms"
      subtitle={platforms.data ? `${platforms.data.length} with games` : undefined}
      ready={platforms.isSuccess}
      restoreFocusKey={entry.focusKey}
    >
      {platforms.isPending && <p className={ui.muted}>Loading…</p>}
      {platforms.isError && <p className={ui.error}>{errorMessage(platforms.error)}</p>}
      <div className={styles.tileGrid}>
        {platforms.data?.map((platform, index) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            focusKey={`platform-${platform.id}`}
            preferred={index === 0}
            onOpen={() =>
              push({
                name: 'grid',
                title: platform.name,
                source: { type: 'platform', platformId: platform.id },
              })
            }
          />
        ))}
      </div>
    </Screen>
  );
}

/** The user's collections, smart collections and the ones RomM derives from metadata. */
export function CollectionsScreen() {
  const { push, pop } = useUi();
  const entry = useCurrentEntry();
  const collections = useCollections();
  useControls({ back: { label: 'Home', run: pop } }, { level: 10 });

  return (
    <Screen
      title="Collections"
      subtitle={collections.data ? `${collections.data.length} collections` : undefined}
      ready={collections.isSuccess}
      restoreFocusKey={entry.focusKey}
    >
      {collections.isPending && <p className={ui.muted}>Loading…</p>}
      {collections.isError && <p className={ui.error}>{errorMessage(collections.error)}</p>}
      {collections.data?.length === 0 && (
        <p className={ui.muted}>
          No collections yet. Mark a game as a favourite from its page, or create collections in
          RomM, and they appear here.
        </p>
      )}
      <div className={styles.tileGrid}>
        {collections.data?.map((collection, index) => (
          <CollectionCard
            key={`${collection.kind}-${collection.id}`}
            collection={collection}
            focusKey={`collection-${collection.kind}-${collection.id}`}
            preferred={index === 0}
            onOpen={() =>
              push({
                name: 'grid',
                title: collection.name,
                source: { type: 'collection', kind: collection.kind, id: collection.id },
              })
            }
          />
        ))}
      </div>
    </Screen>
  );
}
