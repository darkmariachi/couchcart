import { z } from 'zod';

export const RELEASES_REPO = { owner: 'darkmariachi', repo: 'couchcart' };
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO.owner}/${RELEASES_REPO.repo}/releases/latest`;

const latestRelease = z.object({ tag_name: z.string().min(1) });

/** The version of the newest published release, as its tag names it. */
export async function fetchLatestReleaseVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${RELEASES_REPO.owner}/${RELEASES_REPO.repo}/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`GitHub answered with HTTP ${response.status}.`);
  return latestRelease.parse(await response.json()).tag_name;
}
