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
 * Serves images from the RomM server (covers, screenshots, platform icons) to the renderer
 * as `romm-cover://cover/<encoded server path>`.
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
    const type = contentTypeFor(assetPath);
    try {
      return imageResponse(await readFile(cacheFile), type);
    } catch {
      // Not cached yet.
    }

    try {
      const response = await getSource().fetchAsset(assetPath);
      const served = response.headers.get('content-type') ?? '';
      if (!response.ok || !served.startsWith('image/')) return new Response(null, { status: 404 });

      const image = Buffer.from(await response.arrayBuffer());
      await mkdir(cacheDir, { recursive: true });
      // Write-then-rename so a concurrent reader never sees half an image.
      const temp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, image);
      await rename(temp, cacheFile);
      return imageResponse(image, type);
    } catch (error) {
      log.warn('Could not load cover', error);
      return new Response(null, { status: 502 });
    }
  };
}

/**
 * Bitmap formats are recognised by their content, but SVG and ICO are not, so those get
 * their type from the file extension.
 */
function contentTypeFor(assetPath: string): string {
  const path = assetPath.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.ico')) return 'image/x-icon';
  return 'image/*';
}

function imageResponse(image: Buffer, type: string): Response {
  return new Response(new Uint8Array(image), {
    headers: {
      // An entry never changes once written (RomM versions its image URLs).
      'content-type': type,
      'cache-control': 'max-age=31536000, immutable',
    },
  });
}
