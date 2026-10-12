import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RetroArchInstall {
  executablePath: string;
  /** Folder RetroArch must be started from (the Steam build needs this, see launch()). */
  workingDir: string;
  /** Folder holding retroarch.cfg and, by default, its saves, cores and BIOS files. */
  dataDir: string;
  coresDir: string;
  systemDir: string;
  /** The Steam build installs cores as DLC and has no Online Updater for them. */
  kind: 'steam' | 'standalone';
  version: string | null;
  /** True for the copy the launcher downloaded into its own folder. */
  managed: boolean;
}

/** Library folders listed in Steam's libraryfolders.vdf. */
export function parseSteamLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    (match[1] ?? '').replace(/\\\\/g, '\\'),
  );
}

export async function findSteamRoots(): Promise<string[]> {
  if (process.platform === 'win32') {
    const roots = [join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam')];
    try {
      // Steam records its real install folder here when it is not in Program Files.
      const { stdout } = await execFileAsync(
        'reg',
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { windowsHide: true, timeout: 5000 },
      );
      const path = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)?.[1]?.trim();
      if (path) roots.unshift(path);
    } catch {
      // Steam is not installed, or reg.exe is unavailable; the default path still applies.
    }
    return roots;
  }
  return [
    join(homedir(), '.steam', 'steam'),
    join(homedir(), '.local', 'share', 'Steam'),
    join(homedir(), '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ];
}

async function steamCandidates(): Promise<string[]> {
  const executable = process.platform === 'win32' ? 'retroarch.exe' : 'retroarch';
  const libraries = new Set<string>();
  for (const root of await findSteamRoots()) {
    libraries.add(root);
    try {
      const vdf = readFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      parseSteamLibraryFolders(vdf).forEach((library) => libraries.add(library));
    } catch {
      // No library list at this root.
    }
  }
  return [...libraries].map((library) =>
    join(library, 'steamapps', 'common', 'RetroArch', executable),
  );
}

function standaloneCandidates(): string[] {
  if (process.platform === 'win32') {
    const env = process.env;
    return [
      'C:\\RetroArch-Win64\\retroarch.exe',
      'C:\\RetroArch\\retroarch.exe',
      join(env['APPDATA'] ?? '', 'RetroArch', 'retroarch.exe'),
      join(env['ProgramFiles'] ?? 'C:\\Program Files', 'RetroArch', 'retroarch.exe'),
    ];
  }
  const onPath = (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'retroarch'));
  // Flatpak (the usual install on a Steam Deck) exports a launcher script per app.
  const flatpak = [
    join(homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', FLATPAK_ID),
    join('/var/lib/flatpak/exports/bin', FLATPAK_ID),
  ];
  return [...onPath, ...flatpak];
}

const FLATPAK_ID = 'org.libretro.RetroArch';

/**
 * Where an install keeps retroarch.cfg and, unless the config says otherwise, its cores
 * and BIOS files. A portable or Steam install keeps them next to the executable; a Linux
 * package install uses ~/.config/retroarch, and a Flatpak its own folder under ~/.var/app.
 */
function dataRootFor(executablePath: string, home: string): string {
  const root = dirname(executablePath);
  if (existsSync(join(root, 'cores'))) return root;
  if (executablePath.endsWith(FLATPAK_ID)) {
    return join(home, '.var', 'app', FLATPAK_ID, 'config', 'retroarch');
  }
  return join(home, '.config', 'retroarch');
}

/** A folder named in retroarch.cfg, or null when the setting is absent or left at its default. */
function configuredDir(config: string, key: string, home: string): string | null {
  const value = new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, 'm').exec(config)?.[1];
  if (!value || value === 'default') return null;
  if (value.startsWith('~')) return join(home, value.slice(1));
  return isAbsolute(value) ? value : null;
}

export function describeInstall(
  executablePath: string,
  coresDirOverride: string | null,
  home: string = homedir(),
) {
  const root = dirname(executablePath);
  const kind = /[\\/]steamapps[\\/]common[\\/]/i.test(executablePath) ? 'steam' : 'standalone';
  const dataRoot = dataRootFor(executablePath, home);
  let config = '';
  if (dataRoot !== root) {
    // Distribution packages often keep cores outside the config folder (/usr/lib/libretro,
    // for one) and say so in retroarch.cfg.
    try {
      config = readFileSync(join(dataRoot, 'retroarch.cfg'), 'utf8');
    } catch {
      // RetroArch has not been started yet, so there is no config to read.
    }
  }
  return {
    executablePath,
    workingDir: root,
    dataDir: dataRoot,
    coresDir:
      coresDirOverride ??
      configuredDir(config, 'libretro_directory', home) ??
      join(dataRoot, 'cores'),
    systemDir: configuredDir(config, 'system_directory', home) ?? join(dataRoot, 'system'),
    kind,
  } as const;
}

/** Runs `retroarch --version`; a null result means the file is not a working RetroArch. */
export async function readRetroArchVersion(executablePath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], {
      cwd: dirname(executablePath),
      windowsHide: true,
      timeout: 10_000,
    });
    return /Version:\s*(\S+)/.exec(`${stdout}\n${stderr}`)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface LocateOptions {
  /** From settings: when set, only this path is considered. */
  executablePath: string | null;
  coresDir: string | null;
  /** Where the launcher puts RetroArch when it downloads it; preferred when present. */
  managedExecutable?: string | null;
}

export async function locateRetroArch(options: LocateOptions): Promise<RetroArchInstall | null> {
  const candidates = options.executablePath
    ? [options.executablePath]
    : [
        ...(options.managedExecutable ? [options.managedExecutable] : []),
        ...standaloneCandidates(),
        ...(await steamCandidates()),
      ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const version = await readRetroArchVersion(candidate);
    if (version) {
      return {
        ...describeInstall(candidate, options.coresDir),
        version,
        managed: candidate === options.managedExecutable,
      };
    }
  }
  return null;
}
