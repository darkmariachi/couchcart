import { describe, expect, it } from 'vitest';
import {
  decideSync,
  type LocalFile,
  type RemoteFile,
  type SyncRecord,
} from '../src/main/saves/syncDecision';

// "A" is the content at the last sync; "B" and "C" are later, different contents.
const local = (hash: string): LocalFile => ({ hash });
const remote = (hash: string | null, overrides: Partial<RemoteFile> = {}): RemoteFile => ({
  id: 10,
  hash,
  updatedAt: '2026-01-01T10:00:00+00:00',
  ...overrides,
});
const record: SyncRecord = {
  hash: 'A',
  remoteId: 10,
  remoteUpdatedAt: '2026-01-01T10:00:00+00:00',
};

const action = (...args: Parameters<typeof decideSync>) => decideSync(...args).action;

describe('first contact (no sync record)', () => {
  it('does nothing when neither side has the file', () => {
    expect(action(null, null, null)).toBe('none');
  });

  it('uploads a save that only exists on this PC', () => {
    expect(action(local('A'), null, null)).toBe('upload');
  });

  it('downloads a save that only exists on the server', () => {
    expect(action(null, remote('A'), null)).toBe('download');
  });

  it('links identical copies without transferring anything', () => {
    expect(action(local('A'), remote('A'), null)).toBe('link');
  });

  it('treats different copies as a conflict rather than picking a winner', () => {
    expect(action(local('A'), remote('B'), null)).toBe('conflict');
  });

  it('cannot prove equality without a server hash, so it is a conflict', () => {
    expect(action(local('A'), remote(null), null)).toBe('conflict');
  });
});

describe('after a previous sync', () => {
  it('does nothing when neither side changed', () => {
    expect(action(local('A'), remote('A'), record)).toBe('none');
  });

  it('uploads when only this PC changed', () => {
    expect(action(local('B'), remote('A'), record)).toBe('upload');
  });

  it('downloads when only the server changed', () => {
    expect(action(local('A'), remote('B', { id: 11 }), record)).toBe('download');
  });

  it('reports a conflict when both changed to different content', () => {
    expect(action(local('B'), remote('C', { id: 11 }), record)).toBe('conflict');
  });

  it('links when both changed to the same content', () => {
    expect(action(local('B'), remote('B', { id: 11 }), record)).toBe('link');
  });

  it('ignores a new server version id when the content is unchanged', () => {
    // RomM stores every upload as a new row; re-uploading identical bytes is not a change.
    expect(
      action(local('A'), remote('A', { id: 99, updatedAt: '2026-02-02T00:00:00Z' }), record),
    ).toBe('none');
  });
});

describe('deletions', () => {
  it('restores a file deleted on this PC', () => {
    expect(action(null, remote('A'), record)).toBe('download');
  });

  it('downloads the newer server version when the local file is gone', () => {
    expect(action(null, remote('B', { id: 11 }), record)).toBe('download');
  });

  it('removes the local copy when the server copy was deleted and nothing changed here', () => {
    expect(action(local('A'), null, record)).toBe('delete_local');
  });

  it('keeps and re-uploads local progress made after the server copy was deleted', () => {
    expect(action(local('B'), null, record)).toBe('upload');
  });

  it('forgets a file deleted on both sides', () => {
    expect(action(null, null, record)).toBe('forget');
  });
});

describe('files without a server hash (save states)', () => {
  const stateRecord: SyncRecord = { ...record };

  it('is in sync while the server id and timestamp match the record', () => {
    expect(action(local('A'), remote(null), stateRecord)).toBe('none');
  });

  it('detects a server change through its timestamp', () => {
    expect(
      action(local('A'), remote(null, { updatedAt: '2026-01-02T09:00:00+00:00' }), stateRecord),
    ).toBe('download');
  });

  it('detects a server change through a new id', () => {
    expect(action(local('A'), remote(null, { id: 11 }), stateRecord)).toBe('download');
  });

  it('uploads a local change', () => {
    expect(action(local('B'), remote(null), stateRecord)).toBe('upload');
  });

  it('cannot tell whether both sides converged, so it reports a conflict', () => {
    expect(action(local('B'), remote(null, { id: 11 }), stateRecord)).toBe('conflict');
  });
});

describe('clock skew', () => {
  // The function receives no local timestamps at all, so a wrong PC clock cannot influence
  // it. These cases pin the server-timestamp behaviour that could look order-dependent.
  it('downloads a server change even when its timestamp is older than the recorded one', () => {
    const olderStamp = remote(null, { updatedAt: '2025-06-01T00:00:00+00:00' });

    expect(action(local('A'), olderStamp, record)).toBe('download');
  });

  it('does not treat a far-future server timestamp as a change when the hash matches', () => {
    const future = remote('A', { updatedAt: '2099-01-01T00:00:00+00:00' });

    expect(action(local('A'), future, record)).toBe('none');
  });

  it('still uploads local progress when the server timestamp is in the future', () => {
    const future = remote('A', { updatedAt: '2099-01-01T00:00:00+00:00' });

    expect(action(local('B'), future, record)).toBe('upload');
  });

  it('compares server timestamps as recorded strings, not as local time', () => {
    // Same instant written in another offset counts as a change: a harmless extra
    // download, never a skipped one.
    const sameInstantOtherZone = remote(null, { updatedAt: '2026-01-01T11:00:00+01:00' });

    expect(action(local('A'), sameInstantOtherZone, record)).toBe('download');
  });
});

describe('every decision explains itself', () => {
  it.each([
    [local('B'), remote('C'), record],
    [local('A'), null, record],
    [null, remote('A'), null],
  ] as const)('gives a reason', (l, r, rec) => {
    expect(decideSync(l, r, rec).reason.length).toBeGreaterThan(5);
  });
});
