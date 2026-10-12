import { useState } from 'react';
import { assetUrl, platformIconPaths } from '../assets';
import styles from './ui.module.css';

/** A Material Design icon, given its path from `@mdi/js`. Sized by the surrounding text. */
export function Icon({ path }: { path: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** A platform's icon from the RomM server; shows nothing when the server has none. */
export function PlatformIcon({ slug, className }: { slug: string; className?: string }) {
  const candidates = platformIconPaths(slug);
  const [attempt, setAttempt] = useState(0);
  const path = candidates[attempt];
  if (!path) return null;

  return (
    <img
      className={className ?? styles.platformIcon}
      src={assetUrl(path)}
      alt=""
      decoding="async"
      onError={() => setAttempt(attempt + 1)}
    />
  );
}
