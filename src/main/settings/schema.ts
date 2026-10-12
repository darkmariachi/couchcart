import { z } from 'zod';

export const CURRENT_SETTINGS_VERSION = 2;

const retroarchSchema = z.object({
  /** Null means "auto-detect"; set it to pin a specific install. */
  executablePath: z.string().nullable(),
  /** Null means the `cores` folder that belongs to the detected install. */
  coresDir: z.string().nullable(),
  fullscreen: z.boolean(),
  extraArgs: z.array(z.string()),
});

export const settingsSchema = z.object({
  version: z.literal(CURRENT_SETTINGS_VERSION),
  serverUrl: z.url().nullable(),
  username: z.string().nullable(),
  /** Shown in RomM next to saves uploaded from this PC. */
  deviceName: z.string().min(1),
  retroarch: retroarchSchema,
  /** Null means `<app data>/roms`. */
  cacheDir: z.string().nullable(),
  /** Core names without extension, e.g. `mupen64plus_next_libretro`. */
  coreOverrides: z.object({
    platforms: z.record(z.string(), z.string()),
    games: z.record(z.string(), z.string()),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

const V2_ADDITIONS = {
  retroarch: { executablePath: null, coresDir: null, fullscreen: true, extraArgs: [] },
  cacheDir: null,
  coreOverrides: { platforms: {}, games: {} },
} satisfies Partial<Settings>;

export function defaultSettings(deviceName: string): Settings {
  return {
    version: CURRENT_SETTINGS_VERSION,
    serverUrl: null,
    username: null,
    deviceName,
    ...structuredClone(V2_ADDITIONS),
  };
}

type RawSettings = Record<string, unknown>;

// One step per version: the key is the version a step upgrades *from*.
const MIGRATIONS: Record<number, (old: RawSettings) => RawSettings> = {
  // v2 added RetroArch, cache and core-override settings (Milestone 2).
  1: (v1) => ({ ...v1, ...structuredClone(V2_ADDITIONS), version: 2 }),
};

/**
 * Upgrades a parsed settings file of any older version to the current shape.
 * Returns null when the content is not recognisable as settings at all, or comes from a
 * newer version of the app.
 */
export function migrateSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return null;

  let current = raw as RawSettings;
  while (typeof current['version'] === 'number' && current['version'] < CURRENT_SETTINGS_VERSION) {
    const migrate = MIGRATIONS[current['version']];
    if (!migrate) return null;
    current = migrate(current);
  }

  const parsed = settingsSchema.safeParse(current);
  return parsed.success ? parsed.data : null;
}
