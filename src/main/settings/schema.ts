import { z } from 'zod';

export const CURRENT_SETTINGS_VERSION = 1;

export const settingsSchema = z.object({
  version: z.literal(CURRENT_SETTINGS_VERSION),
  serverUrl: z.url().nullable(),
  username: z.string().nullable(),
  /** Shown in RomM next to saves uploaded from this PC. */
  deviceName: z.string().min(1),
});

export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(deviceName: string): Settings {
  return { version: CURRENT_SETTINGS_VERSION, serverUrl: null, username: null, deviceName };
}

/**
 * Upgrades a parsed settings file of any older version to the current shape. Each future
 * version adds one step here (v1 -> v2, v2 -> v3, ...), applied in order.
 * Returns null when the content is not recognisable as settings at all.
 */
export function migrateSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return null;
  if (typeof raw.version !== 'number' || raw.version > CURRENT_SETTINGS_VERSION) return null;

  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
