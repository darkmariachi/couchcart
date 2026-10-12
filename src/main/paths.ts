import { basename, join } from 'node:path';
import { LauncherError } from './errors';

/**
 * Turns a name that came from the server into a single, safe path segment. Anything that
 * could escape the target folder is rejected outright rather than repaired.
 */
export function safeSegment(name: string): string {
  const isPlainName =
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/]/.test(name) &&
    basename(name) === name;
  if (!isPlainName) {
    throw new LauncherError('invalid_input', `Refusing unsafe file name from server: ${name}`);
  }
  // Characters Windows cannot store. Replacing them keeps Linux and Windows layouts equal.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
}

/** Where the launcher keeps its files. Everything it writes lives under these folders. */
export class DataPaths {
  constructor(
    private readonly dataDir: string,
    private readonly getCacheDirOverride: () => string | null,
  ) {}

  get romCacheDir(): string {
    return this.getCacheDirOverride() ?? join(this.dataDir, 'roms');
  }

  romFile(platformSlug: string, fileName: string): string {
    return join(this.romCacheDir, safeSegment(platformSlug), safeSegment(fileName));
  }

  savesDir(platformSlug: string): string {
    return join(this.dataDir, 'saves', safeSegment(platformSlug));
  }

  statesDir(platformSlug: string): string {
    return join(this.dataDir, 'states', safeSegment(platformSlug));
  }

  get launchConfigFile(): string {
    return join(this.dataDir, 'retroarch', 'launcher.cfg');
  }
}
