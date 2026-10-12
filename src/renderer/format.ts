export function formatSize(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(megabytes))} MB`;
}

/** "5 min ago", "yesterday", "12 days ago". */
export function formatWhen(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / 60 / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function shortCoreName(core: string): string {
  return core.replace(/_libretro$/, '');
}

/** The entry after `current` in `options`, wrapping around. */
export function nextOption<T>(options: readonly T[], current: T): T {
  const next = options[(options.indexOf(current) + 1) % options.length];
  return next === undefined ? current : next;
}
