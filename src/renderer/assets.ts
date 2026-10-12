// Game artwork is not bundled with the launcher. Covers, screenshots and platform icons
// are loaded from the user's own RomM server (through the main process, which caches
// them on disk), so they always match that server.

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
