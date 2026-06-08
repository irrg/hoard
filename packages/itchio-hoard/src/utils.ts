import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export class NoDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDownloadError';
  }
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 3,
  logger: (msg: string) => void = () => {},
): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, options);
    if (r.status !== 429 || attempt >= retries) return r;
    const retryAfter = r.headers.get('retry-after');
    const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
    logger(`Rate limited, retrying in ${wait / 1000}s...`);
    await new Promise((res) => setTimeout(res, wait));
    delay *= 2;
  }
}

export async function download(
  url: string,
  dir: string,
  name: string,
  filename: string,
  logger: (msg: string) => void = () => {},
): Promise<void> {
  logger(`Downloading ${name} - ${filename}`);

  const response = await fetch(url);

  if (!response.headers.get('content-disposition')) {
    throw new NoDownloadError('Http response is not a download, skipping');
  }

  const outPath = path.join(dir, filename);

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(outPath),
  );

  logger(`Downloaded ${filename}`);
}

export function cleanPath(p: string): string {
  let clean = p.replace(/[<>:|?*"/\\]/g, '-');
  clean = clean.replace(/(.)[.]\1+$/, '-');
  return clean;
}

export async function md5sum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function runConcurrently(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  let firstError: { value: unknown } | null = null;

  for (const task of tasks) {
    const p: Promise<void> = task()
      .catch((e) => {
        if (!firstError) firstError = { value: e };
      })
      .finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  // drain all in-flight tasks before propagating any error
  await Promise.all(executing);
  if (firstError) throw (firstError as { value: unknown }).value;
}
