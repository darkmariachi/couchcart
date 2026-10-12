/** A save or state file as it currently exists on this PC. */
export interface LocalFile {
  hash: string;
}

/** The current version of the same file on the RomM server. */
export interface RemoteFile {
  id: number;
  /** Content hash when the server provides one (saves do, states do not). */
  hash: string | null;
  /** The server's own timestamp for this version. */
  updatedAt: string;
}

/** What both sides looked like the last time this file was in sync. */
export interface SyncRecord {
  hash: string;
  remoteId: number;
  remoteUpdatedAt: string;
}

export type SyncAction =
  /** Nothing to do. */
  | 'none'
  /** Send the local file to the server. */
  | 'upload'
  /** Replace (or create) the local file from the server, backing up any local copy. */
  | 'download'
  /** Both sides hold the same content; only the sync record needs writing. */
  | 'link'
  /** Both sides changed independently. Never resolved automatically. */
  | 'conflict'
  /** The server copy was deleted on purpose; back up and remove the local copy. */
  | 'delete_local'
  /** Both copies are gone; drop the sync record. */
  | 'forget';

export interface SyncDecision {
  action: SyncAction;
  reason: string;
}

/**
 * Decides what to do with one file, given this PC's copy, the server's copy and the record
 * of the last sync.
 *
 * Deliberately absent: any comparison between this PC's clock and the server's. "Changed"
 * always means "differs from what we recorded at the last sync": by content hash where one
 * exists, otherwise by the server's own id and timestamp for the remote side. A PC with a
 * wrong clock therefore cannot make an old save look newer than a recent one.
 */
export function decideSync(
  local: LocalFile | null,
  remote: RemoteFile | null,
  record: SyncRecord | null,
): SyncDecision {
  if (!record) return decideFirstContact(local, remote);

  const localChanged = local !== null && local.hash !== record.hash;
  const remoteChanged = remote !== null && remoteDiffersFromRecord(remote, record);

  if (!local && !remote) {
    return { action: 'forget', reason: 'deleted on this PC and on the server' };
  }

  if (!local) {
    // A missing local file is far more likely an accident (cleared folder, new disk) than
    // a wish to delete the save everywhere, so the server copy is restored, not deleted.
    return { action: 'download', reason: 'missing on this PC; restoring from the server' };
  }

  if (!remote) {
    return localChanged
      ? { action: 'upload', reason: 'deleted on the server, but this PC has newer progress' }
      : { action: 'delete_local', reason: 'deleted on the server and unchanged here' };
  }

  if (localChanged && remoteChanged) {
    return sameContent(local, remote)
      ? { action: 'link', reason: 'both sides changed to the same content' }
      : { action: 'conflict', reason: 'changed on this PC and on the server since the last sync' };
  }
  if (localChanged) return { action: 'upload', reason: 'changed on this PC' };
  if (remoteChanged) return { action: 'download', reason: 'changed on the server' };
  return { action: 'none', reason: 'already in sync' };
}

/** No sync record: this PC has never synced this file. */
function decideFirstContact(local: LocalFile | null, remote: RemoteFile | null): SyncDecision {
  if (!local && !remote) return { action: 'none', reason: 'nothing to sync' };
  if (!remote) return { action: 'upload', reason: 'new on this PC' };
  if (!local) return { action: 'download', reason: 'new on the server' };
  return sameContent(local, remote)
    ? { action: 'link', reason: 'identical on both sides' }
    : // Two unrelated histories. Timestamps cannot say which one the player wants.
      { action: 'conflict', reason: 'exists on this PC and on the server with different content' };
}

function remoteDiffersFromRecord(remote: RemoteFile, record: SyncRecord): boolean {
  if (remote.hash !== null) return remote.hash !== record.hash;
  // Both values come from the server's clock, so comparing them is skew-free.
  return remote.id !== record.remoteId || remote.updatedAt !== record.remoteUpdatedAt;
}

function sameContent(local: LocalFile, remote: RemoteFile): boolean {
  return remote.hash !== null && remote.hash === local.hash;
}
