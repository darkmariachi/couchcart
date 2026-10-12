// Images are not bundled with the launcher. Covers, screenshots, platform icons and the
// RomM logo are all loaded from the user's own RomM server (through the main process,
// which caches them on disk), so the artwork always matches that server.

/** URL for a server-relative image path such as `/assets/romm/resources/...`. */
export function assetUrl(path: string): string {
  return `romm-cover://cover/${encodeURIComponent(path)}`;
}

/** RomM ships one icon per platform, named after the platform slug. */
export function platformIconPaths(slug: string): string[] {
  const name = slug.toLowerCase();
  return [
    `/assets/platforms/${name}.svg`,
    `/assets/platforms/${name}.ico`,
    '/assets/platforms/default.ico',
  ];
}

export const ROMM_LOGO_PATH = '/assets/isotipo.svg';

/** RomM's own placeholder for games without cover art. */
export const MISSING_COVER_PATH = '/assets/default/cover/missing_cover.svg';
