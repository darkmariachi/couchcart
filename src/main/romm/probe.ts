import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { ProbeFinding } from '../../shared/ipc';
import type { AuthSession } from './auth';
import type { RommClient, SimpleRom } from './client';

const MAX_SAVE_BYTES_TO_HASH = 64 * 1024 * 1024;

/**
 * Answers the questions the OpenAPI spec leaves open, against the live server. Read-only:
 * it never uploads or changes anything. Each check is independent, so one failure still
 * leaves the others reported.
 */
export async function runApiProbe(
  client: RommClient,
  auth: AuthSession,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ProbeFinding[]> {
  const sampleRom = await findSampleRom(client);
  const checks: [string, () => Promise<Omit<ProbeFinding, 'question'>>][] = [
    ['How long do tokens live?', async () => tokenLifetimes(auth)],
    ['How are cover images addressed?', () => coverAccess(client, sampleRom, fetchImpl)],
    ['Do ROM downloads support Range (resume)?', () => rangeSupport(client, sampleRom)],
    ['Which algorithm is save content_hash?', () => contentHashAlgorithm(client)],
  ];

  const findings: ProbeFinding[] = [];
  for (const [question, check] of checks) {
    try {
      findings.push({ question, ...(await check()) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      findings.push({ question, answer: 'Check failed', evidence: [message] });
    }
  }
  return findings;
}

async function findSampleRom(client: RommClient): Promise<SimpleRom | null> {
  const page = await client.listRoms({ limit: 50 });
  const singleFile = page.items.filter((rom) => rom.has_simple_single_file);
  return singleFile.find((rom) => rom.path_cover_small) ?? singleFile[0] ?? page.items[0] ?? null;
}

function tokenLifetimes(auth: AuthSession): Omit<ProbeFinding, 'question'> {
  const lifetimes = auth.describeLifetimes();
  if (!lifetimes) return { answer: 'Not logged in', evidence: [] };
  return {
    answer: `access ≈ ${formatDuration(lifetimes.accessSeconds)}, refresh ≈ ${
      lifetimes.refreshSeconds === null ? 'unknown' : formatDuration(lifetimes.refreshSeconds)
    } remaining`,
    evidence: ['Measured from the current session, so a fresh login shows the full lifetime.'],
  };
}

async function coverAccess(
  client: RommClient,
  rom: SimpleRom | null,
  fetchImpl: typeof fetch,
): Promise<Omit<ProbeFinding, 'question'>> {
  const coverPath = rom?.path_cover_small;
  if (!coverPath) return { answer: 'No ROM with a cover found to test', evidence: [] };

  if (/^https?:\/\//.test(coverPath)) {
    return { answer: 'Absolute URL in path_cover_small', evidence: [coverPath] };
  }

  const candidates = [
    { pattern: '/assets/romm/resources/<path>', path: `/assets/romm/resources/${coverPath}` },
    { pattern: '/<path>', path: `/${coverPath.replace(/^\/+/, '')}` },
  ];

  const evidence = [`path_cover_small = ${coverPath}`];
  let answer: string | null = null;
  for (const { pattern, path } of candidates) {
    const anonymous = await fetchImpl(`${client.baseUrl}${path}`);
    void anonymous.body?.cancel().catch(() => undefined);
    const authed = await client.fetchRaw(path);
    void authed.body?.cancel().catch(() => undefined);

    const contentType = authed.headers.get('content-type') ?? 'no content-type';
    evidence.push(
      `${pattern} → ${anonymous.status} anonymous, ${authed.status} with bearer (${contentType})`,
    );
    if (authed.ok && contentType.startsWith('image/')) {
      answer ??= `<server>${pattern}; ${anonymous.ok ? 'no auth needed' : 'bearer token required'}`;
    }
  }
  return { answer: answer ?? 'No candidate URL returned an image', evidence };
}

async function rangeSupport(
  client: RommClient,
  rom: SimpleRom | null,
): Promise<Omit<ProbeFinding, 'question'>> {
  if (!rom) return { answer: 'No ROM found to test', evidence: [] };

  const path = `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`;
  const response = await client.fetchRaw(path, { headers: { Range: 'bytes=0-0' } });
  void response.body?.cancel().catch(() => undefined);

  const supported = response.status === 206;
  return {
    answer: supported ? 'Yes (206 Partial Content)' : `No (HTTP ${response.status})`,
    evidence: [
      `GET /api/roms/{id}/content/{file_name} with Range: bytes=0-0 → ${response.status}`,
      `Accept-Ranges: ${response.headers.get('accept-ranges') ?? '(absent)'}`,
      `Content-Range: ${response.headers.get('content-range') ?? '(absent)'}`,
    ],
  };
}

async function contentHashAlgorithm(client: RommClient): Promise<Omit<ProbeFinding, 'question'>> {
  const saves = await client.listSaves();
  const sample = saves.find(
    (save) => save.content_hash && save.file_size_bytes <= MAX_SAVE_BYTES_TO_HASH,
  );
  if (!sample?.content_hash) {
    return {
      answer: 'Unknown: no save with a content_hash on the server yet',
      evidence: [`${saves.length} save(s) found for this user`],
    };
  }

  const response = await client.fetchRaw(`/api/saves/${sample.id}/content`);
  if (!response.ok) {
    return { answer: `Could not download a save (HTTP ${response.status})`, evidence: [] };
  }
  const content = Buffer.from(await response.arrayBuffer());

  const digests: Record<string, string> = {
    md5: createHash('md5').update(content).digest('hex'),
    sha1: createHash('sha1').update(content).digest('hex'),
    sha256: createHash('sha256').update(content).digest('hex'),
    crc32: crc32(content).toString(16).padStart(8, '0'),
  };
  const expected = sample.content_hash.toLowerCase();
  const match = Object.entries(digests).find(([, digest]) => digest === expected)?.[0];

  return {
    answer: match ?? 'None of md5 / sha1 / sha256 / crc32 of the raw file',
    evidence: [
      `content_hash has ${expected.length} hex characters`,
      `Compared against ${content.length} downloaded bytes of one save`,
    ],
  };
}

function formatDuration(seconds: number): string {
  if (seconds >= 2 * 86_400) return `${Math.round(seconds / 86_400)} days`;
  if (seconds >= 2 * 3600) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}
