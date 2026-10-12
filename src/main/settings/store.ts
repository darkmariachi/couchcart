import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { writeFileAtomicSync } from '../fs/atomic';
import { defaultSettings, migrateSettings, settingsSchema, type Settings } from './schema';

export class SettingsStore {
  private settings: Settings;

  constructor(
    private readonly filePath: string,
    defaultDeviceName: string,
  ) {
    this.settings = this.load(defaultDeviceName);
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: Partial<Omit<Settings, 'version'>>): Settings {
    this.settings = settingsSchema.parse({ ...this.settings, ...patch });
    writeFileAtomicSync(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`);
    return this.settings;
  }

  private load(defaultDeviceName: string): Settings {
    if (!existsSync(this.filePath)) return defaultSettings(defaultDeviceName);

    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch {
      // Falls through to the unreadable-file handling below.
    }

    const migrated = migrateSettings(raw);
    if (migrated) return migrated;

    // Keep the unreadable file for inspection rather than silently discarding it.
    copyFileSync(this.filePath, `${this.filePath}.invalid`);
    return defaultSettings(defaultDeviceName);
  }
}
