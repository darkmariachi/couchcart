import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { focusByKey } from '../input/focus';

interface VirtualGridProps<T> {
  items: T[];
  /** Identifies an item; also used as its focus key. */
  keyOf: (item: T) => string;
  renderItem: (item: T, isFirst: boolean) => ReactNode;
  /**
   * Item to focus once the grid is on screen (when returning from a game page). Without
   * one, the first item is focused.
   */
  initialFocusKey?: string | null;
}

// Layout in rem, so the grid scales with the rest of the UI.
const MIN_COLUMN_REM = 11;
const COLUMN_GAP_REM = 1;
const ROW_GAP_REM = 1.2;
// Rows kept rendered above and below the visible ones. Focus can only move to a rendered
// card, so this is also how far a held direction can run ahead of the scroll animation.
const BUFFER_ROWS = 3;

interface Metrics {
  columns: number;
  rowHeight: number;
  /** Distance from the top of the scrolling area to the top of the grid. */
  offsetTop: number;
  viewportHeight: number;
}

/**
 * A cover grid that only renders the rows near the viewport, so a platform with thousands
 * of games costs the same as one with fifty. It scrolls with the surrounding screen (the
 * nearest `data-scroll-container`), not in a box of its own.
 */
export function VirtualGrid<T>({ items, keyOf, renderItem, initialFocusKey }: VirtualGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<string | null | undefined>(initialFocusKey);

  const scroller = () => gridRef.current?.closest<HTMLElement>('[data-scroll-container]') ?? null;

  // Measure the available width and one card, then lay out everything from those.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const container = scroller();
    if (!grid || !container) return;

    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const gap = COLUMN_GAP_REM * rem;
      const columns = Math.max(
        1,
        Math.floor((grid.clientWidth + gap) / (MIN_COLUMN_REM * rem + gap)),
      );
      const columnWidth = (grid.clientWidth - gap * (columns - 1)) / columns;
      // Until a card has rendered, estimate: a 3:4 cover plus room for the title.
      const cardHeight = firstItemRef.current?.offsetHeight ?? columnWidth * (4 / 3) + 3 * rem;
      const offsetTop =
        grid.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;

      setMetrics((previous) => {
        const next = {
          columns,
          rowHeight: cardHeight + ROW_GAP_REM * rem,
          offsetTop,
          viewportHeight: container.clientHeight,
        };
        const unchanged =
          previous &&
          previous.columns === next.columns &&
          Math.abs(previous.rowHeight - next.rowHeight) < 1 &&
          Math.abs(previous.offsetTop - next.offsetTop) < 1 &&
          previous.viewportHeight === next.viewportHeight;
        return unchanged ? previous : next;
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    observer.observe(container);
    if (firstItemRef.current) observer.observe(firstItemRef.current);
    return () => observer.disconnect();
  }, [items.length, metrics?.columns]);

  useEffect(() => {
    const container = scroller();
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollTop(container.scrollTop));
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Place focus once: scroll the wanted item's row into the rendered range, then focus it.
  useEffect(() => {
    if (pendingFocus === undefined || !metrics || items.length === 0) return;
    const wanted = pendingFocus ?? (items[0] ? keyOf(items[0]) : null);
    const index = wanted ? items.findIndex((item) => keyOf(item) === wanted) : -1;
    const target = index === -1 ? items[0] : items[index];
    if (!target) return;

    if (focusByKey(keyOf(target))) {
      setPendingFocus(undefined);
      return;
    }
    const row = Math.floor(Math.max(0, index) / metrics.columns);
    const container = scroller();
    if (container) {
      container.scrollTop =
        metrics.offsetTop + row * metrics.rowHeight - metrics.viewportHeight / 3;
      setScrollTop(container.scrollTop);
    }
  }, [pendingFocus, metrics, items, keyOf, scrollTop]);

  // When the real card size replaces the estimate, rows move; keep the focused card in view.
  useEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && gridRef.current?.contains(focused)) {
      focused.scrollIntoView({ block: 'nearest' });
    }
  }, [metrics?.rowHeight, metrics?.columns]);

  const columns = metrics?.columns ?? 1;
  const rowHeight = metrics?.rowHeight ?? 1;
  const rowCount = Math.ceil(items.length / columns);
  const relativeTop = scrollTop - (metrics?.offsetTop ?? 0);
  const firstRow = Math.max(0, Math.floor(relativeTop / rowHeight) - BUFFER_ROWS);
  const lastRow = metrics
    ? Math.min(
        rowCount - 1,
        Math.ceil((relativeTop + metrics.viewportHeight) / rowHeight) + BUFFER_ROWS,
      )
    : 0;
  const visible = items.slice(firstRow * columns, (lastRow + 1) * columns);

  return (
    <div ref={gridRef} style={{ position: 'relative', height: rowCount * rowHeight }}>
      <div
        style={{
          position: 'absolute',
          top: firstRow * rowHeight,
          left: 0,
          right: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          columnGap: `${COLUMN_GAP_REM}rem`,
          rowGap: `${ROW_GAP_REM}rem`,
        }}
      >
        {visible.map((item, position) => {
          const index = firstRow * columns + position;
          return (
            <div key={keyOf(item)} ref={position === 0 ? firstItemRef : undefined}>
              {renderItem(item, index === 0)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
