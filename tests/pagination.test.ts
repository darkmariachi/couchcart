import { describe, expect, it, vi } from 'vitest';
import { paginate, type Page } from '../src/main/romm/pagination';

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function pagesOf(all: number[], reportTotal: boolean) {
  return vi.fn(async (offset: number, limit: number): Promise<Page<number>> => ({
    items: all.slice(offset, offset + limit),
    total: reportTotal ? all.length : null,
  }));
}

describe('paginate', () => {
  it('yields nothing for an empty result', async () => {
    const fetchPage = pagesOf([], true);

    expect(await collect(paginate(fetchPage, 10))).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops on a short page', async () => {
    const fetchPage = pagesOf([1, 2, 3, 4, 5], false);

    expect(await collect(paginate(fetchPage, 2))).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('uses the total to avoid a trailing empty request', async () => {
    const fetchPage = pagesOf([1, 2, 3, 4], true);

    expect(await collect(paginate(fetchPage, 2))).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('needs one extra request when the total is unknown and the last page is full', async () => {
    const fetchPage = pagesOf([1, 2, 3, 4], false);

    expect(await collect(paginate(fetchPage, 2))).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
