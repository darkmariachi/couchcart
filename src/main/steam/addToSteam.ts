import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SteamShortcutStatus } from '../../shared/ipc';
import { LauncherError } from '../errors';
import { log } from '../logging/logger';
import {
  UnsupportedVdfError,
  hasShortcut,
  mostRecentAccountId,
  parseBinaryVdf,
  serializeBinaryVdf,
  upsertShortcut,
  type ShortcutSpec,
  type VdfMap,
} from './shortcuts';

const execFileAsync = promisify(execFile);

/** Artwork shipped with the launcher, and the name Steam expects for each slot. */
const ARTWORK: [source: string, suffix: string][] = [
  ['cover.png', 'p.png'],
  ['wide-cover.png', '.png'],
  ['hero.jpg', '_hero.jpg'],
  ['logo.png', '_logo.png'],
];

export interface SteamDeps {
  /** Folders where Steam may be installed. */
  findSteamRoots: () => Promise<string[]>;
  isSteamRunning: () => Promise<boolean>;
  /** Asks Steam to close and resolves once it has. */
  stopSteam: (steamRoot: string) => Promise<void>;
  startSteam: (steamRoot: string) => void;
  shortcut: ShortcutSpec;
  /** Folder holding the artwork files. */
  artworkDir: string;
}

interface SteamAccount {
  root: string;
  configDir: string;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The Steam install in use and the folder of the account that signed in last. */
async function findAccount(deps: SteamDeps): Promise<SteamAccount | null> {
  for (const root of await deps.findSteamRoots()) {
    const userdata = join(root, 'userdata');
    const accounts = (await readdir(userdata).catch(() => [] as string[])).filter(
      (name) => /^\d+$/.test(name) && name !== '0',
    );
    if (accounts.length === 0) continue;

    const loginUsers = await readFile(join(root, 'config', 'loginusers.vdf'), 'utf8').catch(
      () => '',
    );
    let account = mostRecentAccountId(loginUsers);
    if (!account || !accounts.includes(account)) {
      // No clear answer from Steam's own list: take the account whose settings changed last.
      const byAge = await Promise.all(
        accounts.map(async (name) => ({
          name,
          changed: await stat(join(userdata, name, 'config', 'localconfig.vdf')).then(
            (info) => info.mtimeMs,
            () => 0,
          ),
        })),
      );
      account = byAge.sort((a, b) => b.changed - a.changed)[0]?.name ?? null;
    }
    if (account) return { root, configDir: join(userdata, account, 'config') };
  }
  return null;
}

async function readShortcuts(file: string): Promise<VdfMap> {
  const data = await readFile(file).catch(() => null);
  if (!data || data.length === 0) return [['shortcuts', []]];
  try {
    return parseBinaryVdf(data);
  } catch (error) {
    if (error instanceof UnsupportedVdfError) {
      log.warn(`Steam's shortcut file was not understood: ${error.message}`);
      throw new LauncherError(
        'internal',
        "Steam's list of non-Steam games is in a form this version does not understand, so it was left alone. Add Couchcart from Steam instead: Games → Add a Non-Steam Game.",
      );
    }
    throw error;
  }
}

export async function getSteamShortcutStatus(deps: SteamDeps): Promise<SteamShortcutStatus> {
  const account = await findAccount(deps);
  if (!account) return { installed: false, running: false, added: false };
  let added = false;
  try {
    added = hasShortcut(
      await readShortcuts(join(account.configDir, 'shortcuts.vdf')),
      deps.shortcut.exe,
    );
  } catch {
    // An unreadable file is reported when the user actually tries to add the shortcut.
  }
  return { installed: true, running: await deps.isSteamRunning(), added };
}

/**
 * Adds the launcher to Steam as a non-Steam game, with its artwork. Steam only reads its
 * shortcut file when it starts and rewrites it while running, so it must be closed first;
 * with `restartSteam` it is closed and started again around the change.
 */
export async function addToSteam(
  deps: SteamDeps,
  options: { restartSteam: boolean },
): Promise<SteamShortcutStatus> {
  const account = await findAccount(deps);
  if (!account) {
    throw new LauncherError('invalid_input', 'Steam was not found on this PC.');
  }

  const wasRunning = await deps.isSteamRunning();
  if (wasRunning) {
    if (!options.restartSteam) {
      throw new LauncherError('busy', 'Steam is open. It has to be closed to add Couchcart.');
    }
    await deps.stopSteam(account.root);
  }

  try {
    const file = join(account.configDir, 'shortcuts.vdf');
    const root = await readShortcuts(file);
    const appId = upsertShortcut(root, deps.shortcut);

    await mkdir(account.configDir, { recursive: true });
    if (await exists(file)) await copyFile(file, `${file}.couchcart-backup`);
    // Write beside the file and swap it in, so a crash cannot leave half a file behind.
    await writeFile(`${file}.couchcart-new`, serializeBinaryVdf(root));
    await rename(`${file}.couchcart-new`, file);

    const grid = join(account.configDir, 'grid');
    await mkdir(grid, { recursive: true });
    for (const [source, suffix] of ARTWORK) {
      await copyFile(join(deps.artworkDir, source), join(grid, `${appId}${suffix}`)).catch(
        (error: unknown) => log.warn(`Steam artwork ${source} could not be copied`, error),
      );
    }
    log.info(`Added to Steam as a non-Steam game (artwork id ${appId})`);
  } finally {
    if (wasRunning) deps.startSteam(account.root);
  }
  return { installed: true, running: wasRunning, added: true };
}

// ---------- The real Steam ----------

export async function isSteamRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', 'IMAGENAME eq steam.exe', '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 10_000 },
      );
      return /steam\.exe/i.test(stdout);
    }
    await execFileAsync('pgrep', ['-x', 'steam'], { timeout: 10_000 });
    return true;
  } catch {
    return false; // pgrep exits with an error when nothing matches
  }
}

const steamProgram = (root: string) =>
  process.platform === 'win32' ? join(root, 'steam.exe') : 'steam';

export async function stopSteam(root: string): Promise<void> {
  spawn(steamProgram(root), ['-shutdown'], { detached: true, stdio: 'ignore' })
    .on('error', () => undefined)
    .unref();
  for (let waited = 0; waited < 45_000; waited += 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!(await isSteamRunning())) {
      // Steam writes its files as the last thing it does; give it a moment to finish.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return;
    }
  }
  throw new LauncherError('busy', 'Steam did not close. Close it yourself and try again.');
}

export function startSteam(root: string): void {
  spawn(steamProgram(root), [], { detached: true, stdio: 'ignore' })
    .on('error', (error) => log.warn('Steam could not be started again', error))
    .unref();
}
