import { z } from 'zod';

export const CURRENT_SETTINGS_VERSION = 4;

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
  /** Id RomM assigned to this PC for the current account; null until first registered. */
  deviceId: z.string().nullable(),
  /** How many backups to keep per game in `save-backups`. */
  saveBackupCount: z.number().int().min(1).max(1000),
  retroarch: retroarchSchema,
  /** False until the first-run wizard has been finished. */
  setupComplete: z.boolean(),
  /** Whether the launcher window itself starts fullscreen. */
  launcherFullscreen: z.boolean(),
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

const V3_ADDITIONS = { deviceId: null, saveBackupCount: 10 } satisfies Partial<Settings>;

const V4_ADDITIONS = {
  setupComplete: false,
  launcherFullscreen: true,
} satisfies Partial<Settings>;

export function defaultSettings(deviceName: string): Settings {
  return {
    version: CURRENT_SETTINGS_VERSION,
    serverUrl: null,
    username: null,
    deviceName,
    ...structuredClone(V2_ADDITIONS),
    ...V3_ADDITIONS,
    ...V4_ADDITIONS,
  };
}

type RawSettings = Record<string, unknown>;

// One step per version: the key is the version a step upgrades *from*.
const MIGRATIONS: Record<number, (old: RawSettings) => RawSettings> = {
  // v2 added RetroArch, cache and core-override settings (Milestone 2).
  1: (v1) => ({ ...v1, ...structuredClone(V2_ADDITIONS), version: 2 }),
  // v3 added the RomM device id and the save backup count (Milestone 3).
  2: (v2) => ({ ...v2, ...V3_ADDITIONS, version: 3 }),
  // v4 added the setup wizard flag and launcher fullscreen (Milestone 4). Existing
  // installs see the wizard once too, because it now offers to import RetroArch saves.
  3: (v3) => ({ ...v3, ...V4_ADDITIONS, version: 4 }),
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
