import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeSegment } from '../paths';

export type BackupReason =
  /** The local file was about to be replaced by the server version. */
  | 'replaced-by-server'
  /** The local file was removed because the server copy was deleted. */
  | 'deleted-on-server'
  /** The server's side of a conflict, kept so neither version is lost. */
  | 'server-copy'
  /** The local side of a conflict the user resolved in favour of the server. */
  | 'conflict-local';

/**
 * Keeps the last N backups per game. Every local save the sync engine is about to
 * overwrite or delete is copied here first.
 */
export class SaveBackups {
  constructor(
    private readonly rootDir: string,
    private readonly getKeepCount: () => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private gameDir(platformSlug: string, romBaseName: string): string {
    return join(this.rootDir, safeSegment(platformSlug), safeSegment(romBaseName));
  }

  /** Copies an existing file into the backups. Returns the backup path. */
  async backupFile(
    platformSlug: string,
    romBaseName: string,
    sourcePath: string,
    fileName: string,
    reason: BackupReason,
  ): Promise<string> {
    const target = await this.targetPath(platformSlug, romBaseName, fileName, reason);
    await copyFile(sourcePath, target);
    await this.prune(platformSlug, romBaseName);
    return target;
  }

  /** Stores content that never existed as a local file (the server side of a conflict). */
  async backupContent(
    platformSlug: string,
    romBaseName: string,
    content: Buffer,
    fileName: string,
    reason: BackupReason,
  ): Promise<string> {
    const target = await this.targetPath(platformSlug, romBaseName, fileName, reason);
    await writeFile(target, content);
    await this.prune(platformSlug, romBaseName);
    return target;
  }

  async list(platformSlug: string, romBaseName: string): Promise<string[]> {
    try {
      return (await readdir(this.gameDir(platformSlug, romBaseName))).sort();
    } catch {
      return [];
    }
  }

  private async targetPath(
    platformSlug: string,
    romBaseName: string,
    fileName: string,
    reason: BackupReason,
  ): Promise<string> {
    const dir = this.gameDir(platformSlug, romBaseName);
    await mkdir(dir, { recursive: true });
    // The timestamp leads so that sorting by name is sorting by age.
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    return join(dir, `${stamp}__${reason}__${safeSegment(fileName)}`);
  }

  private async prune(platformSlug: string, romBaseName: string): Promise<void> {
    const dir = this.gameDir(platformSlug, romBaseName);
    const keep = Math.max(1, this.getKeepCount());
    const backups = await this.list(platformSlug, romBaseName);
    const expired = backups.slice(0, Math.max(0, backups.length - keep));
    await Promise.all(expired.map((name) => rm(join(dir, name), { force: true })));
  }
}
