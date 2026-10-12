import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SyncKind, SyncReport } from '../../shared/ipc';
import type { SyncRecord } from './syncDecision';

export interface SyncKey {
  romId: number;
  kind: SyncKind;
  fileName: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_records (
    rom_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    remote_id INTEGER NOT NULL,
    remote_updated_at TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (rom_id, kind, file_name)
  );
  CREATE TABLE IF NOT EXISTS rom_sync_reports (
    rom_id INTEGER PRIMARY KEY,
    report TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS library_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Local memory of what was last synced. Uses Node's built-in SQLite: writes are
 * transactional (a crash cannot leave a half-written record) and, unlike better-sqlite3,
 * there is no native module to rebuild for each Electron version.
 */
export class SyncStore {
  private readonly db: DatabaseSync;

  /** Pass `:memory:` for tests. */
  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.db.exec(SCHEMA);
  }

  /**
   * Sync records describe one account on one server. If a different account logs in, the
   * old records would make that account's missing saves look "deleted on the server", so
   * they are dropped and every file is treated as never synced.
   */
  bindAccount(account: string): void {
    const current = this.db.prepare("SELECT value FROM meta WHERE key = 'account'").get();
    if (current?.['value'] === account) return;
    this.db.exec('BEGIN');
    try {
      this.db.exec(
        'DELETE FROM sync_records; DELETE FROM rom_sync_reports; DELETE FROM library_cache;',
      );
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('account', ?)")
        .run(account);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getRecord({ romId, kind, fileName }: SyncKey): SyncRecord | null {
    const row = this.db
      .prepare(
        `SELECT content_hash, remote_id, remote_updated_at FROM sync_records
         WHERE rom_id = ? AND kind = ? AND file_name = ?`,
      )
      .get(romId, kind, fileName);
    return row ? toRecord(row) : null;
  }

  /** File names with a sync record for this ROM, including ones no longer on disk. */
  listFileNames(romId: number, kind: SyncKind): string[] {
    return this.db
      .prepare('SELECT file_name FROM sync_records WHERE rom_id = ? AND kind = ?')
      .all(romId, kind)
      .map((row) => String(row['file_name']));
  }

  putRecord({ romId, kind, fileName }: SyncKey, record: SyncRecord, syncedAt: Date): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_records
           (rom_id, kind, file_name, content_hash, remote_id, remote_updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        romId,
        kind,
        fileName,
        record.hash,
        record.remoteId,
        record.remoteUpdatedAt,
        syncedAt.toISOString(),
      );
  }

  deleteRecord({ romId, kind, fileName }: SyncKey): void {
    this.db
      .prepare('DELETE FROM sync_records WHERE rom_id = ? AND kind = ? AND file_name = ?')
      .run(romId, kind, fileName);
  }

  saveReport(report: SyncReport): void {
    this.db
      .prepare('INSERT OR REPLACE INTO rom_sync_reports (rom_id, report) VALUES (?, ?)')
      .run(report.romId, JSON.stringify(report));
  }

  getReport(romId: number): SyncReport | null {
    const row = this.db.prepare('SELECT report FROM rom_sync_reports WHERE rom_id = ?').get(romId);
    return row ? (JSON.parse(String(row['report'])) as SyncReport) : null;
  }

  /** ROMs this PC has synced at least one file for. */
  listRomIdsWithRecords(): number[] {
    return this.db
      .prepare('SELECT DISTINCT rom_id FROM sync_records')
      .all()
      .map((row) => Number(row['rom_id']));
  }

  /** Last sync status of every ROM that has one. */
  listReportStatuses(): Map<number, SyncReport['status']> {
    const statuses = new Map<number, SyncReport['status']>();
    for (const row of this.db.prepare('SELECT rom_id, report FROM rom_sync_reports').all()) {
      const report = JSON.parse(String(row['report'])) as SyncReport;
      statuses.set(Number(row['rom_id']), report.status);
    }
    return statuses;
  }

  /**
   * Library data from the last time the server answered, so browsing and playing
   * downloaded games still work when it does not.
   */
  putCache(key: string, value: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO library_cache (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value));
  }

  getCache<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM library_cache WHERE key = ?').get(key);
    return row ? (JSON.parse(String(row['value'])) as T) : null;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

function toRecord(row: Record<string, unknown>): SyncRecord {
  return {
    hash: String(row['content_hash']),
    remoteId: Number(row['remote_id']),
    remoteUpdatedAt: String(row['remote_updated_at']),
  };
}
