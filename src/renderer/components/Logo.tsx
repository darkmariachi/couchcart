/** The Couchcart mark: a game cartridge with a play button. Sized by its `className`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="couchcart-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3fd6c8" />
          <stop offset="1" stopColor="#178f86" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#couchcart-logo)" />
      {/* Cartridge body with its connector at the bottom. */}
      <path d="M17 12h30a3 3 0 0 1 3 3v32h-9v7H23v-7h-9V15a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M27 21v18l15-9z" fill="#178f86" />
    </svg>
  );
}
