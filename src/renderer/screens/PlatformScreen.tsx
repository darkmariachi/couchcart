import { useEffect, useMemo, useState } from 'react';
import type { RomSummary } from '../../shared/ipc';
import { errorMessage } from '../api';
import { Focusable } from '../components/Focusable';
import { GameCard } from '../components/GameCard';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { VirtualGrid } from '../components/VirtualGrid';
import { usePlatformRoms, usePlatforms } from '../hooks';
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
  sort: SortMode,
  downloadedOnly: boolean,
  search: string,
): RomSummary[] {
  const term = search.trim().toLowerCase();
  const visible = roms.filter(
    (rom) =>
      (!downloadedOnly || rom.downloaded) && (!term || rom.name.toLowerCase().includes(term)),
  );
  const byName = (a: RomSummary, b: RomSummary) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });

  switch (sort) {
    case 'name':
      return visible.sort(byName);
    case 'played':
      return visible.sort((a, b) => newestFirst(a.lastPlayed, b.lastPlayed) || byName(a, b));
    case 'added':
      return visible.sort((a, b) => newestFirst(a.createdAt, b.createdAt) || byName(a, b));
  }
}

export function PlatformScreen({ platformId }: { platformId: number }) {
  const { push, pop, replace } = useUi();
  const entry = useCurrentEntry();
  const platforms = usePlatforms();
  const roms = usePlatformRoms(platformId);

  const [sort, setSort] = useState<SortMode>('name');
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);

  const games = useMemo(
    () => arrange(roms.data ?? [], sort, downloadedOnly, search),
    [roms.data, sort, downloadedOnly, search],
  );

  // Searching or filtering can remove the card that had focus; pick a new one then.
  useEffect(() => {
    if (!searching && !focusedElement()) focusFirst();
  }, [games, searching]);

  const all = platforms.data ?? [];
  const index = all.findIndex((candidate) => candidate.id === platformId);
  const platform = all[index];
  const neighbour = (step: number) => all[(index + step + all.length) % all.length];
  const switchTo = (step: number) => {
    const target = neighbour(step);
    if (target && target.id !== platformId) replace({ name: 'platform', platformId: target.id });
  };

  // Returning from a game page puts focus back on that game's card, which the grid has to
  // scroll to first; anything else (a toolbar button) the screen restores itself.
  const cameFromGame = entry.focusKey?.startsWith('rom-') ?? false;

  const cycleSort = () =>
    setSort(SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length] ?? 'name');

  useControls(
    {
      back: { label: 'Back', run: pop },
      x: { label: 'Search', run: () => setSearching(true) },
      y: { label: `Sort: ${SORT_LABELS[sort]}`, run: cycleSort },
      ...(all.length > 1 && {
        lb: { label: neighbour(-1)?.name ?? 'Previous', run: () => switchTo(-1) },
        rb: { label: neighbour(1)?.name ?? 'Next', run: () => switchTo(1) },
      }),
    },
    { level: 10 },
  );

  return (
    <Screen
      title={platform?.name ?? 'Games'}
      subtitle={roms.data ? `${games.length} of ${roms.data.length} games` : undefined}
      ready={roms.isSuccess}
      restoreFocusKey={cameFromGame ? null : entry.focusKey}
    >
      <div className={styles.toolbar}>
        <Focusable variant="button" focusKey="tool-search" onPress={() => setSearching(true)}>
          {search ? `Search: “${search}”` : 'Search'}
        </Focusable>
        {search && (
          <Focusable variant="button" focusKey="tool-clear" onPress={() => setSearch('')}>
            Clear search
          </Focusable>
        )}
        <Focusable variant="button" focusKey="tool-sort" onPress={cycleSort}>
          Sort: {SORT_LABELS[sort]}
        </Focusable>
        <Focusable
          variant="button"
          focusKey="tool-downloaded"
          onPress={() => setDownloadedOnly(!downloadedOnly)}
        >
          {downloadedOnly ? 'Showing: on this PC' : 'Showing: all games'}
        </Focusable>
      </div>

      {roms.isPending && <p className={ui.muted}>Loading games…</p>}
      {roms.isError && <p className={ui.error}>{errorMessage(roms.error)}</p>}
      {roms.isSuccess && games.length === 0 && (
        <p className={ui.muted}>No games match. Clear the search or change the filter.</p>
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
            onOpen={(romId) => push({ name: 'game', romId })}
          />
        )}
      />

      {searching && (
        <OnScreenKeyboard
          title={`Search ${platform?.name ?? 'games'}`}
          initialValue={search}
          onCancel={() => setSearching(false)}
          onSubmit={(value) => {
            setSearch(value);
            setSearching(false);
          }}
        />
      )}
    </Screen>
  );
}
