import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Folder holding one account's saves, states, backups and sync records.
 *
 * Saves belong to a person on a server, so two people sharing a PC, or one person with two
 * servers, must not share a save folder: one's progress would be uploaded to the other's
 * account. The readable prefix is for humans browsing the folder; the hash makes it unique.
 */
export function accountDirFor(dataDir: string, serverUrl: string, username: string): string {
  const hash = createHash('sha256').update(`${serverUrl}|${username}`).digest('hex').slice(0, 10);
  const readable = username.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'user';
  return join(dataDir, 'accounts', `${readable}-${hash}`);
}

/** Used before anyone has signed in, so nothing account-specific lands in a real account. */
export function signedOutDir(dataDir: string): string {
  return join(dataDir, 'accounts', '_signed-out');
}

// Where this data lived before accounts had folders of their own.
const LEGACY_ENTRIES = ['saves', 'states', 'save-backups', 'sync.db', 'sync.db-wal', 'sync.db-shm'];

/**
 * Moves data from the old shared layout into the first account that opens after an
 * upgrade (the person who was signed in). Runs once: afterwards nothing is left to move.
 * Returns whether anything was adopted.
 */
export function adoptLegacyData(dataDir: string, accountDir: string): boolean {
  if (existsSync(accountDir)) return false;
  const present = LEGACY_ENTRIES.filter((entry) => existsSync(join(dataDir, entry)));
  if (present.length === 0) return false;

  mkdirSync(accountDir, { recursive: true });
  for (const entry of present) renameSync(join(dataDir, entry), join(accountDir, entry));
  return true;
}
