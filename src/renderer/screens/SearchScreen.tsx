import { useState } from 'react';
import { mdiHistory, mdiMagnify } from '@mdi/js';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { useControls } from '../input/controls';
import { suggestGlobally } from '../librarySearch';
import { useUi } from '../store/ui';
import styles from './screens.module.css';

const RECENT_KEY = 'recentSearches';
const RECENT_LIMIT = 8;

function loadRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function remember(term: string): void {
  const others = loadRecent().filter((entry) => entry.toLowerCase() !== term.toLowerCase());
  localStorage.setItem(RECENT_KEY, JSON.stringify([term, ...others].slice(0, RECENT_LIMIT)));
}

/**
 * The Search section. It is a screen of its own, rather than only a keyboard, so that it
 * is a normal stop when moving along the top bar with LB/RB.
 */
export function SearchScreen({ openKeyboard }: { openKeyboard: boolean }) {
  const { push, pop } = useUi();
  const [typing, setTyping] = useState(openKeyboard);
  const [recent] = useState(loadRecent);

  const search = (value: string) => {
    setTyping(false);
    const term = value.trim();
    if (!term) return;
    remember(term);
    push({ name: 'grid', title: `“${term}”`, source: { type: 'search', term } });
  };

  useControls(
    {
      back: { label: 'Home', run: pop },
      x: { label: 'Search', run: () => setTyping(true) },
    },
    { level: 10 },
  );

  return (
    <Screen title="Search" subtitle="Across every platform in your library">
      <div className={styles.toolbar}>
        <Focusable
          variant="primary"
          preferred
          focusKey="search-start"
          onPress={() => setTyping(true)}
        >
          <Icon path={mdiMagnify} />
          Search your library
        </Focusable>
      </div>

      {recent.length > 0 && (
        <>
          <h2 className={styles.sectionHeader}>
            <Icon path={mdiHistory} />
            Recent searches
          </h2>
          <div className={styles.toolbar}>
            {recent.map((term) => (
              <Focusable
                key={term}
                variant="button"
                focusKey={`recent-search-${term}`}
                onPress={() => search(term)}
              >
                {term}
              </Focusable>
            ))}
          </div>
        </>
      )}
      {recent.length === 0 && (
        <p className={ui.muted}>
          Games are suggested as you type. To look only inside one platform or collection, open it
          and press X there instead.
        </p>
      )}

      {typing && (
        <OnScreenKeyboard
          title="Search your library"
          initialValue=""
          suggest={suggestGlobally}
          onCancel={() => setTyping(false)}
          onSubmit={search}
        />
      )}
    </Screen>
  );
}
