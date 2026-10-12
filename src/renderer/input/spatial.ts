export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Distance between two ranges on one axis; 0 when they overlap. */
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}

/**
 * Picks the element focus should move to from `from` in `direction`, by geometry alone.
 *
 * Left/right only ever move within the same row (candidates must overlap vertically), so
 * reaching the end of a row never jumps diagonally into another one. Up/down prefer what
 * is straight above or below but fall back to the nearest element in that direction, so
 * moving down from a long row into a shorter one still lands somewhere sensible.
 */
export function pickNext<T extends { box: Box }>(
  from: Box,
  candidates: T[],
  direction: Direction,
): T | null {
  const horizontal = direction === 'left' || direction === 'right';
  let best: T | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const to = candidate.box;
    // How far the candidate lies in the requested direction; negative means "behind".
    const ahead = {
      right: to.left - from.right,
      left: from.left - to.right,
      down: to.top - from.bottom,
      up: from.top - to.bottom,
    }[direction];
    // Rounding in layouts can make neighbours overlap by a pixel.
    if (ahead < -1) continue;

    const sideways = horizontal
      ? gap(from.top, from.bottom, to.top, to.bottom)
      : gap(from.left, from.right, to.left, to.right);
    if (horizontal && sideways > 0) continue;

    // Among equally aligned candidates the one whose centre is closest wins.
    const centreOffset = horizontal
      ? Math.abs((to.top + to.bottom) / 2 - (from.top + from.bottom) / 2)
      : Math.abs((to.left + to.right) / 2 - (from.left + from.right) / 2);
    const score = Math.max(0, ahead) + sideways * 2 + centreOffset * 0.01;

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
