import { suggestNames } from './suggest';

/**
 * Suggestions for a search of the whole library. The server finds candidates (it knows
 * every platform); the same ranking as everywhere else then orders and trims them.
 */
export async function suggestGlobally(typed: string): Promise<string[]> {
  const term = typed.trim();
  if (term.length < 2) return [];
  const result = await window.romm.library.suggest(term);
  return result.ok ? suggestNames(result.value, term) : [];
}
