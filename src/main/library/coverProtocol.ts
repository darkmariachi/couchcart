import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../logging/logger';

export const COVER_SCHEME = 'romm-cover';

export interface CoverSource {
  /** Fetches a server-relative path with the current session. Throws when logged out. */
  fetchAsset: (path: string) => Promise<Response>;
}

/**
 * Serves cover art to the renderer as `romm-cover://cover/<encoded server path>`.
 *
 * The renderer has no network access, so images come through here. Each image is stored on
 * disk the first time it is requested and served from there afterwards, which also makes
 * covers work offline. RomM puts a `?ts=` version in the path, so a changed cover is a new
 * cache entry rather than a stale one.
 */
export function createCoverHandler(cacheDir: string, getSource: () => CoverSource) {
  return async (request: Request): Promise<Response> => {
    const assetPath = decodeURIComponent(new URL(request.url).pathname.slice(1));
    // Only RomM's own asset tree. This keeps the handler from being used to reach
    // arbitrary URLs or API endpoints with the user's session.
    if (!assetPath.startsWith('/assets/') || assetPath.includes('..')) {
      return new Response(null, { status: 400 });
    }

    const cacheFile = join(cacheDir, createHash('sha1').update(assetPath).digest('hex'));
    try {
      return imageResponse(await readFile(cacheFile));
    } catch {
      // Not cached yet.
    }

    try {
      const response = await getSource().fetchAsset(assetPath);
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('image/')) return new Response(null, { status: 404 });

      const image = Buffer.from(await response.arrayBuffer());
      await mkdir(cacheDir, { recursive: true });
      // Write-then-rename so a concurrent reader never sees half an image.
      const temp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, image);
      await rename(temp, cacheFile);
      return imageResponse(image);
    } catch (error) {
      log.warn('Could not load cover', error);
      return new Response(null, { status: 502 });
    }
  };
}

function imageResponse(image: Buffer): Response {
  return new Response(new Uint8Array(image), {
    headers: {
      // Chromium sniffs the actual image type; the entry never changes once written.
      'content-type': 'image/*',
      'cache-control': 'max-age=31536000, immutable',
    },
  });
}
