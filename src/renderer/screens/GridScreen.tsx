import { useCallback, useEffect, useMemo, useState } from 'react';
import { mdiFilterVariant, mdiMagnify, mdiSort } from '@mdi/js';
import type { GridSource, RomSummary } from '../../shared/ipc';
import { errorMessage } from '../api';
import { Focusable } from '../components/Focusable';
import { GameCard } from '../components/GameCard';
import { Icon, PlatformIcon } from '../components/Icon';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { VirtualGrid } from '../components/VirtualGrid';
import { nextOption } from '../format';
import { suggestGlobally } from '../librarySearch';
import { suggestNames } from '../suggest';
import { useGridRoms, usePlatforms } from '../hooks';
import { useControls } from '../input/controls';
import { focusFirst, focusedElement } from '../input/focus';
import { useCurrentEntry, useUi } from '../store/ui';
import styles from './screens.module.css';

type SortMode = 'name' | 'played' | 'added';
const SORT_LABELS: Record<SortMode, string> = {
  name: 'Name',
  played: 'Recently played',
  added: 'Recently added',
};
const SORT_ORDER: SortMode[] = ['name', 'played', 'added'];

const focusKeyOf = (rom: RomSummary) => `rom-${rom.id}`;

function newestFirst(a: string | null, b: string | null): number {
  return (b ? Date.parse(b) : 0) - (a ? Date.parse(a) : 0);
}

function arrange(
  roms: RomSummary[],
  sort: SortMode | 'relevance',
  downloadedOnly: boolean,
  filter: string,
): RomSummary[] {
  const term = filter.trim().toLowerCase();
  const visible = roms.filter(
    (rom) =>
      (!downloadedOnly || rom.downloaded) && (!term || rom.name.toLowerCase().includes(term)),
  );
  const byName = (a: RomSummary, b: RomSummary) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });

  switch (sort) {
    case 'relevance':
      return visible; // the order the server ranked a search in
    case 'name':
      return visible.sort(byName);
    case 'played':
      return visible.sort((a, b) => newestFirst(a.lastPlayed, b.lastPlayed) || byName(a, b));
    case 'added':
      return visible.sort((a, b) => newestFirst(a.createdAt, b.createdAt) || byName(a, b));
  }
}

/** A grid of games: one platform, one collection, or the results of a library search. */
export function GridScreen({ source, title }: { source: GridSource; title: string }) {
  const { push, pop, replace } = useUi();
  const entry = useCurrentEntry();
  const platforms = usePlatforms();
  const roms = useGridRoms(source);

  const isSearch = source.type === 'search';
  const [sort, setSort] = useState<SortMode | 'relevance'>(isSearch ? 'relevance' : 'name');
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [filter, setFilter] = useState('');
  const [typing, setTyping] = useState(false);

  const games = useMemo(
    () => arrange(roms.data ?? [], sort, downloadedOnly, filter),
    [roms.data, sort, downloadedOnly, filter],
  );

  // Filtering can remove the card that had focus; pick a new one then.
  useEffect(() => {
    if (!typing && !focusedElement()) focusFirst();
  }, [games, typing]);

  const platform =
    source.type === 'platform'
      ? platforms.data?.find((candidate) => candidate.id === source.platformId)
      : undefined;

  // Filtering a platform or collection suggests from the games in it, which are already
  // loaded; a library search asks the server.
  const names = useMemo(() => (roms.data ?? []).map((rom) => rom.name), [roms.data]);
  const suggestFromList = useCallback((typed: string) => suggestNames(names, typed), [names]);

  const cycleSort = () => setSort(nextOption(SORT_ORDER, sort === 'relevance' ? 'added' : sort));
  const submitText = (value: string) => {
    setTyping(false);
    // On a search screen typing starts a new search; elsewhere it narrows this list.
    if (!isSearch) setFilter(value);
    else if (value.trim()) {
      replace({
        name: 'grid',
        title: `“${value.trim()}”`,
        source: { type: 'search', term: value.trim() },
      });
    }
  };

  // Returning from a game page puts focus back on that game's card, which the grid has to
  // scroll to first; anything else (a toolbar button) the screen restores itself.
  const cameFromGame = entry.focusKey?.startsWith('rom-') ?? false;

  useControls(
    {
      back: { label: 'Back', run: pop },
      x: { label: isSearch ? 'New search' : 'Filter', run: () => setTyping(true) },
      y: {
        label: `Sort: ${sort === 'relevance' ? 'Best match' : SORT_LABELS[sort]}`,
        run: cycleSort,
      },
    },
    { level: 10 },
  );

  return (
    <Screen
      title={isSearch ? `Search: ${title}` : title}
      leading={platform && <PlatformIcon slug={platform.slug} className={styles.headerIcon} />}
      subtitle={
        roms.data
          ? games.length === roms.data.length
            ? `${games.length} games`
            : `${games.length} of ${roms.data.length} games`
          : undefined
      }
      ready={roms.isSuccess}
      restoreFocusKey={cameFromGame ? null : entry.focusKey}
    >
      <div className={styles.toolbar}>
        <Focusable variant="button" focusKey="tool-text" onPress={() => setTyping(true)}>
          <Icon path={mdiMagnify} />
          {isSearch ? 'New search' : filter ? `Filter: “${filter}”` : 'Filter by name'}
        </Focusable>
        {filter && (
          <Focusable variant="button" focusKey="tool-clear" onPress={() => setFilter('')}>
            Clear filter
          </Focusable>
        )}
        <Focusable variant="button" focusKey="tool-sort" onPress={cycleSort}>
          <Icon path={mdiSort} />
          {sort === 'relevance' ? 'Best match' : SORT_LABELS[sort]}
        </Focusable>
        <Focusable
          variant="button"
          focusKey="tool-downloaded"
          onPress={() => setDownloadedOnly(!downloadedOnly)}
        >
          <Icon path={mdiFilterVariant} />
          {downloadedOnly ? 'On this PC' : 'All games'}
        </Focusable>
      </div>

      {roms.isPending && <p className={ui.muted}>Loading games…</p>}
      {roms.isError && <p className={ui.error}>{errorMessage(roms.error)}</p>}
      {roms.isSuccess && games.length === 0 && (
        <p className={ui.muted}>
          {isSearch
            ? 'No games match that search.'
            : 'No games match. Clear the filter to see all.'}
        </p>
      )}

      <VirtualGrid
        items={games}
        keyOf={focusKeyOf}
        initialFocusKey={cameFromGame ? entry.focusKey : null}
        renderItem={(rom, isFirst) => (
          <GameCard
            rom={rom}
            focusKey={focusKeyOf(rom)}
            preferred={isFirst}
            showPlatform={source.type !== 'platform'}
            onOpen={(romId) => push({ name: 'game', romId })}
          />
        )}
      />

      {typing && (
        <OnScreenKeyboard
          title={isSearch ? 'Search your library' : `Filter ${title}`}
          initialValue={isSearch ? '' : filter}
          onCancel={() => setTyping(false)}
          onSubmit={submitText}
          suggest={isSearch ? suggestGlobally : suggestFromList}
        />
      )}
    </Screen>
  );
}
