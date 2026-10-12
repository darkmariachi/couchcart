export interface LaunchConfigOptions {
  savesDir: string;
  statesDir: string;
  /** Further settings, such as controller assignments. They cannot replace the ones above. */
  extra?: Record<string, string>;
}

/**
 * Contents of the config layered over the user's own retroarch.cfg via --appendconfig.
 * Only what the launcher must control is set, so video, audio and input settings stay the
 * user's.
 */
export function buildLaunchConfig({ savesDir, statesDir, extra }: LaunchConfigOptions): string {
  const settings: Record<string, string> = {
    ...extra,
    savefile_directory: toConfigPath(savesDir),
    savestate_directory: toConfigPath(statesDir),
    // Without these RetroArch adds per-core or per-content subfolders, and the sync engine
    // could no longer predict where a game's save lives.
    sort_savefiles_enable: 'false',
    sort_savefiles_by_content_enable: 'false',
    sort_savestates_enable: 'false',
    sort_savestates_by_content_enable: 'false',
    // Otherwise RetroArch writes the overrides above into the user's main config on exit.
    config_save_on_exit: 'false',
  };
  return `${Object.entries(settings)
    .map(([key, value]) => `${key} = "${value}"`)
    .join('\n')}\n`;
}

// RetroArch accepts forward slashes on Windows; they avoid any escaping ambiguity.
function toConfigPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export interface LaunchArgsOptions {
  corePath: string;
  romPath: string;
  configPath: string;
  fullscreen: boolean;
  extraArgs: string[];
}

export function buildLaunchArgs(options: LaunchArgsOptions): string[] {
  return [
    '-L',
    options.corePath,
    options.romPath,
    '--appendconfig',
    options.configPath,
    ...(options.fullscreen ? ['--fullscreen'] : []),
    ...options.extraArgs,
  ];
}
