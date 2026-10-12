import { describe, expect, it } from 'vitest';
import { suggestNames } from '../src/renderer/suggest';

const library = [
  'Super Mario 64',
  'Mario Kart 64',
  'Mario Party',
  'Mario Party 2',
  'Paper Mario',
  'Dr. Mario 64',
  'Super Smash Bros.',
  'Kirby 64 - The Crystal Shards',
  'Primary Colours',
  'Mario Kart 64', // a second dump of the same game
];

describe('suggestNames', () => {
  it('offers titles that start with the text before ones that only contain it', () => {
    expect(suggestNames(library, 'mario')).toEqual([
      'Mario Party',
      'Mario Kart 64',
      'Mario Party 2',
      'Paper Mario',
      'Dr. Mario 64',
      'Super Mario 64',
    ]);
  });

  it('ranks a word start above a match in the middle of a word', () => {
    // "Primary" contains "mar" mid-word; every Mario title has it at a word start.
    const suggestions = suggestNames(library, 'mar', 10);

    expect(suggestions.at(-1)).toBe('Primary Colours');
    expect(suggestions.slice(0, 3)).toEqual(['Mario Party', 'Mario Kart 64', 'Mario Party 2']);
  });

  it('offers each name once even when the library has several dumps of it', () => {
    expect(suggestNames(library, 'kart')).toEqual(['Mario Kart 64']);
  });

  it('ignores case and surrounding spaces', () => {
    expect(suggestNames(library, '  KIRBY ')).toEqual(['Kirby 64 - The Crystal Shards']);
  });

  it('waits for two characters before suggesting anything', () => {
    expect(suggestNames(library, '')).toEqual([]);
    expect(suggestNames(library, 'm')).toEqual([]);
    expect(suggestNames(library, 'ma').length).toBeGreaterThan(0);
  });

  it('respects the limit and returns nothing when nothing matches', () => {
    expect(suggestNames(library, 'mario', 2)).toEqual(['Mario Party', 'Mario Kart 64']);
    expect(suggestNames(library, 'zelda')).toEqual([]);
  });
});
