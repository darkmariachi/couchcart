/**
 * Picks game names to suggest for what has been typed so far.
 *
 * Names where the text starts the title or one of its words come first (typing "mar"
 * should offer "Mario Kart 64" before "Super Smash Bros."), then names that merely contain
 * it. Within each group shorter names win, since they are usually the game itself rather
 * than a spin-off. Different dumps of the same game share a name and are offered once.
 */
export function suggestNames(names: readonly string[], typed: string, limit = 6): string[] {
  const term = typed.trim().toLowerCase();
  if (term.length < 2) return [];

  const ranked: { name: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    const position = lower.indexOf(term);
    if (position === -1) continue;
    seen.add(lower);

    const startsWord = position === 0 || /[^a-z0-9]/.test(lower.charAt(position - 1));
    ranked.push({ name, rank: position === 0 ? 0 : startsWord ? 1 : 2 });
  }

  return ranked
    .sort(
      (a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((entry) => entry.name);
}
