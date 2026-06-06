import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export class NoDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoDownloadError";
  }
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 3,
): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, options);
    if (r.status !== 429 || attempt >= retries) return r;
    const retryAfter = r.headers.get("retry-after");
    const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
    console.log(`Rate limited, retrying in ${wait / 1000}s...`);
    await new Promise((res) => setTimeout(res, wait));
    delay *= 2;
  }
}

export async function streamToFile(
  url: string,
  outPath: string,
  cookie?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": "Mozilla/5.0",
    Accept: "*/*",
  };
  if (cookie) headers["Cookie"] = cookie;

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("No response body");
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(outPath),
  );
}

export async function md5sum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function cleanPath(p: string): string {
  return p.replace(/[<>:|?*"/\\]/g, "-").replace(/\.{2,}/g, "-");
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

  await Promise.all(executing);
  if (firstError) throw (firstError as { value: unknown }).value;
}
