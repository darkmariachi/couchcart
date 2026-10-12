import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Writes via a sibling temp file and a rename, so a crash mid-write leaves either the
 * old file or the new one, never a truncated mix.
 */
export function writeFileAtomicSync(filePath: string, data: string | Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, data);
  renameSync(tempPath, filePath);
}
