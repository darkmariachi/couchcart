import { readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import defaultBios from '../../../config/bios.default.json';

/** One thing a platform needs in RetroArch's `system` folder; any listed file satisfies it. */
export interface BiosRequirement {
  name: string;
  anyOf: string[];
}

export type BiosMap = Record<string, BiosRequirement[]>;
export const DEFAULT_BIOS: BiosMap = defaultBios;

/** Case-insensitive existence check, since BIOS dumps come in every capitalisation. */
async function existsIgnoringCase(systemDir: string, relativePath: string): Promise<boolean> {
  try {
    const wanted = basename(relativePath).toLowerCase();
    const entries = await readdir(join(systemDir, dirname(relativePath)));
    return entries.some((entry) => entry.toLowerCase() === wanted);
  } catch {
    return false;
  }
}

/**
 * Describes the BIOS requirements of a platform that are not met, as text for the user.
 * An empty result means nothing is known to be missing (including "no requirements known").
 */
export async function findMissingBios(
  platformSlugs: string[],
  systemDir: string,
  requirements: BiosMap = DEFAULT_BIOS,
): Promise<string[]> {
  const needed = platformSlugs.map((slug) => requirements[slug]).find(Boolean) ?? [];
  const missing: string[] = [];
  for (const requirement of needed) {
    const found = await Promise.all(
      requirement.anyOf.map((file) => existsIgnoringCase(systemDir, file)),
    );
    if (!found.some(Boolean)) {
      missing.push(`${requirement.name} (one of: ${requirement.anyOf.join(', ')})`);
    }
  }
  return missing;
}
