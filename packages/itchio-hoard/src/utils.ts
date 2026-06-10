import { createWriteStream } from 'fs';
import { rename, unlink } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { NoDownloadError } from '@irrg/hoard-core';

export { NoDownloadError, fetchWithRetry, md5sum, runConcurrently } from '@irrg/hoard-core';

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
  const partialPath = outPath + '.partial';

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(partialPath),
    );
    await rename(partialPath, outPath);
  } catch (e) {
    await unlink(partialPath).catch(() => {});
    throw e;
  }

  logger(`Downloaded ${filename}`);
}

export function cleanPath(p: string): string {
  let clean = p.replace(/[<>:|?*"/\\]/g, '-');
  clean = clean.replace(/(.)[.]\1+$/, '-');
  return clean;
}
