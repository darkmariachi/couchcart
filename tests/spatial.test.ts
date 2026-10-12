import { describe, expect, it } from 'vitest';
import { pickNext, type Box } from '../src/renderer/input/spatial';

const box = (left: number, top: number, width = 100, height = 100): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/** A grid of 100x100 cells with 20px gaps; `id` is "row,column". */
function grid(rows: number[]): { id: string; box: Box }[] {
  return rows.flatMap((columns, row) =>
    Array.from({ length: columns }, (_, column) => ({
      id: `${row},${column}`,
      box: box(column * 120, row * 120),
    })),
  );
}

const cells = grid([5, 5, 3]);
const at = (id: string) => cells.find((cell) => cell.id === id)?.box ?? box(0, 0);
const move = (from: string, direction: Parameters<typeof pickNext>[2]) =>
  pickNext(
    at(from),
    cells.filter((cell) => cell.id !== from),
    direction,
  )?.id ?? null;

describe('pickNext in a grid', () => {
  it('moves to the adjacent cell in each direction', () => {
    expect(move('1,2', 'left')).toBe('1,1');
    expect(move('1,2', 'right')).toBe('1,3');
    expect(move('1,2', 'up')).toBe('0,2');
    expect(move('1,2', 'down')).toBe('2,2');
  });

  it('stays put at the edges', () => {
    expect(move('0,0', 'left')).toBeNull();
    expect(move('0,0', 'up')).toBeNull();
    expect(move('2,2', 'down')).toBeNull();
  });

  it('does not jump to another row when a row ends', () => {
    expect(move('0,4', 'right')).toBeNull();
    expect(move('2,2', 'right')).toBeNull();
  });

  it('lands on the nearest cell when the row below is shorter', () => {
    expect(move('1,4', 'down')).toBe('2,2');
    expect(move('1,3', 'down')).toBe('2,2');
  });

  it('prefers the closer row over a perfectly aligned far one', () => {
    expect(move('2,1', 'up')).toBe('1,1');
  });
});

describe('pickNext between differently sized elements', () => {
  const toolbar = { id: 'toolbar', box: box(0, 0, 300, 50) };
  const wide = { id: 'wide', box: box(0, 70, 600, 100) };
  const first = { id: 'first', box: box(0, 200) };
  const second = { id: 'second', box: box(120, 200) };
  const all = [toolbar, wide, first, second];
  const from = (item: { id: string; box: Box }, direction: Parameters<typeof pickNext>[2]) =>
    pickNext(
      item.box,
      all.filter((other) => other !== item),
      direction,
    )?.id ?? null;

  it('goes down from a wide element to the item nearest its centre', () => {
    expect(from(wide, 'down')).toBe('second');
  });

  it('goes up through each row in turn', () => {
    expect(from(second, 'up')).toBe('wide');
    expect(from(wide, 'up')).toBe('toolbar');
  });

  it('treats a one pixel overlap from rounding as adjacent', () => {
    const a = box(0, 0);
    const b = { id: 'b', box: box(99.5, 0) };

    expect(pickNext(a, [b], 'right')?.id).toBe('b');
  });

  it('never picks something behind the current element', () => {
    expect(from(first, 'left')).toBeNull();
    expect(from(toolbar, 'up')).toBeNull();
  });
});
