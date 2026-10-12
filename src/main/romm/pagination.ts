export interface Page<T> {
  items: T[];
  /** Null when the server was asked not to count the full result set. */
  total: number | null;
}

/** Walks a limit/offset endpoint until it runs out of items. */
export async function* paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  pageSize = 100,
): AsyncGenerator<T> {
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    yield* page.items;

    const reachedTotal = page.total !== null && offset + page.items.length >= page.total;
    if (page.items.length < pageSize || reachedTotal) return;
  }
}
