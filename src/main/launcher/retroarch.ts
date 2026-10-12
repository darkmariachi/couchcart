import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RetroArchInstall {
  executablePath: string;
  /** Folder RetroArch must be started from (the Steam build needs this, see launch()). */
  workingDir: string;
  coresDir: string;
  systemDir: string;
  /** The Steam build installs cores as DLC and has no Online Updater for them. */
  kind: 'steam' | 'standalone';
  version: string | null;
}

/** Library folders listed in Steam's libraryfolders.vdf. */
export function parseSteamLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    (match[1] ?? '').replace(/\\\\/g, '\\'),
  );
}

async function findSteamRoots(): Promise<string[]> {
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
  return [join(homedir(), '.steam', 'steam'), join(homedir(), '.local', 'share', 'Steam')];
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
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'retroarch'));
}

function describeInstall(executablePath: string, coresDirOverride: string | null) {
  const root = dirname(executablePath);
  const kind = /[\\/]steamapps[\\/]common[\\/]/i.test(executablePath) ? 'steam' : 'standalone';
  // A portable or Steam install keeps everything next to the executable; a Linux package
  // install keeps user data under ~/.config/retroarch instead.
  const dataRoot = existsSync(join(root, 'cores')) ? root : join(homedir(), '.config', 'retroarch');
  return {
    executablePath,
    workingDir: root,
    coresDir: coresDirOverride ?? join(dataRoot, 'cores'),
    systemDir: join(dataRoot, 'system'),
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
}

export async function locateRetroArch(options: LocateOptions): Promise<RetroArchInstall | null> {
  const candidates = options.executablePath
    ? [options.executablePath]
    : [...standaloneCandidates(), ...(await steamCandidates())];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const version = await readRetroArchVersion(candidate);
    if (version) return { ...describeInstall(candidate, options.coresDir), version };
  }
  return null;
}
