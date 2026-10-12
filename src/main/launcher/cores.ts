import { readdirSync } from 'node:fs';
import defaultCores from '../../../config/cores.default.json';

export type CoreMap = Record<string, string[]>;
export const DEFAULT_CORES: CoreMap = defaultCores;

export function coreFileExtension(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return '.dll';
  return platform === 'darwin' ? '.dylib' : '.so';
}

/** Core names (without extension) present in a RetroArch cores folder. */
export function listInstalledCores(
  coresDir: string,
  platform: NodeJS.Platform = process.platform,
): Set<string> {
  const suffix = `_libretro${coreFileExtension(platform)}`;
  try {
    return new Set(
      readdirSync(coresDir)
        .filter((file) => file.endsWith(suffix))
        .map((file) => file.slice(0, -coreFileExtension(platform).length)),
    );
  } catch {
    return new Set();
  }
}

export interface CoreRequest {
  romId: number;
  platformSlug: string;
  /** RomM's folder name for the platform; used when the slug has no mapping. */
  platformFsSlug: string;
  overrides: { platforms: Record<string, string>; games: Record<string, string> };
  defaults: CoreMap;
  installed: ReadonlySet<string>;
}

export type CoreResolution =
  | { found: true; core: string }
  /** `candidates` lists what would work if installed; empty when the platform is unmapped. */
  | { found: false; candidates: string[] };

/**
 * Picks the core for a game: a per-game override wins over a per-platform override, which
 * wins over the defaults. An override is never silently replaced by another core, because
 * a different core may not read the same save files.
 */
export function resolveCore(request: CoreRequest): CoreResolution {
  const { overrides, defaults, installed } = request;
  const override =
    overrides.games[String(request.romId)] ??
    overrides.platforms[request.platformSlug] ??
    overrides.platforms[request.platformFsSlug];

  const candidates = override
    ? [override]
    : (defaults[request.platformSlug] ?? defaults[request.platformFsSlug] ?? []);

  const core = candidates.find((candidate) => installed.has(candidate));
  return core ? { found: true, core } : { found: false, candidates };
}
