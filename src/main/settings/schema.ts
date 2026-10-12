import { z } from 'zod';

export const CURRENT_SETTINGS_VERSION = 6;

const retroarchSchema = z.object({
  /** Null means "auto-detect"; set it to pin a specific install. */
  executablePath: z.string().nullable(),
  /** Null means the `cores` folder that belongs to the detected install. */
  coresDir: z.string().nullable(),
  fullscreen: z.boolean(),
  extraArgs: z.array(z.string()),
  /** Turns off RetroArch's on-screen touch buttons, which a controller player never needs. */
  hideTouchOverlay: z.boolean(),
});

const gamepadCombo = z.enum(['keep', 'none', 'hold_start', 'hold_select', 'start_select', 'l3_r3']);

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
  controllers: z.object({
    /** Controller signatures in player order; unlisted controllers follow in detection order. */
    playerOrder: z.array(z.string()),
    menuCombo: gamepadCombo,
    quitCombo: gamepadCombo,
  }),
  cache: z.object({
    keep: z.enum(['always', 'limit', 'never']),
    limitGb: z.number().min(1).max(100_000),
  }),
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
  retroarch: {
    executablePath: null,
    coresDir: null,
    fullscreen: true,
    extraArgs: [],
    hideTouchOverlay: true,
  },
  cacheDir: null,
  coreOverrides: { platforms: {}, games: {} },
} satisfies Partial<Settings>;

const V3_ADDITIONS = { deviceId: null, saveBackupCount: 10 } satisfies Partial<Settings>;

const V4_ADDITIONS = {
  setupComplete: false,
  launcherFullscreen: true,
} satisfies Partial<Settings>;

const V5_ADDITIONS = {
  // Holding Start works on every controller, so there is always a way back to RetroArch's
  // menu (and from there out of the game) without a keyboard.
  controllers: { playerOrder: [], menuCombo: 'hold_start', quitCombo: 'keep' },
  cache: { keep: 'limit', limitGb: 20 },
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
    ...structuredClone(V5_ADDITIONS),
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
  // v5 added controller assignment and cache retention (Milestone 5).
  4: (v4) => ({ ...v4, ...structuredClone(V5_ADDITIONS), version: 5 }),
  // v6 added hiding RetroArch's touch overlay.
  5: (v5) => ({
    ...v5,
    retroarch: { ...(v5['retroarch'] as object), hideTouchOverlay: true },
    version: 6,
  }),
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
