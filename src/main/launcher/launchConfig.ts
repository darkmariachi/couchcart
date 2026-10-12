export interface LaunchConfigOptions {
  savesDir: string;
  statesDir: string;
  hideTouchOverlay: boolean;
  /** Further settings, such as controller assignments. They cannot replace the ones above. */
  extra?: Record<string, string>;
}

/**
 * Contents of the config layered over the user's own retroarch.cfg via --appendconfig.
 * Only what the launcher must control is set, so video, audio and input settings stay the
 * user's.
 */
export function buildLaunchConfig(options: LaunchConfigOptions): string {
  const { savesDir, statesDir, extra } = options;
  const settings: Record<string, string> = {
    ...extra,
    // RetroArch can draw touch buttons over the game. They are meant for touchscreens.
    ...(options.hideTouchOverlay && { input_overlay_enable: 'false' }),
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
    // "Close Content" should end the session and return to the launcher, not leave the
    // player in RetroArch's own menu.
    quit_on_close_content: '1',
    // RetroArch's own cloud sync would upload these same save folders somewhere else,
    // behind the back of the sync with RomM. One system has to own the saves.
    cloud_sync_enable: 'false',
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
