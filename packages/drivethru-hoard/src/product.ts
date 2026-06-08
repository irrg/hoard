import { existsSync } from 'fs';
import { writeFile, readFile, mkdir, rename, appendFile, stat } from 'fs/promises';
import path from 'path';

import { API_BASE } from './auth.js';
import { fetchWithRetry, streamToFile, md5sum, normalizePathPart } from './utils.js';

export interface ProductData {
  productId: string;
  orderProductId: number;
  name: string;
  publisher?: { name: string };
  fileLastModified: string;
  files: DownloadItemData[];
}

export interface DownloadItemData {
  index: number;
  filename: string;
  checksums: { checksum: string; checksumDate: string }[] | null;
}

export interface ProductOptions {
  outputDir: string;
  compat: boolean;
  omitPublisher: boolean;
  dryRun: boolean;
}

const SITE_ID = '10';
const POLL_INTERVAL_MS = 500;

export class Product {
  data: ProductData;
  name: string;
  publisherName: string;
  dir: string;
  outputDir: string;
  options: ProductOptions;

  constructor(data: ProductData, options: ProductOptions) {
    this.data = data;
    this.name = data.name;
    this.publisherName = data.publisher?.name ?? 'Others';
    this.outputDir = options.outputDir;
    this.options = options;

    const pub = normalizePathPart(this.publisherName, options.compat);
    const prod = normalizePathPart(this.name, options.compat);

    this.dir = options.omitPublisher
      ? path.join(options.outputDir, prod)
      : path.join(options.outputDir, pub, prod);
  }

  async download(bearerToken: string): Promise<void> {
    if (this.data.files.length === 0) return;

    console.log(`Downloading ${this.name}`);

    let wrote = 0;
    for (const item of this.data.files) {
      if (await this.doDownload(item, bearerToken)) wrote++;
    }

    if (wrote === 0) return;

    await writeFile(
      this.dir + '.json',
      JSON.stringify(
        {
          name: this.name,
          publisher: this.publisherName,
          orderProductId: this.data.orderProductId,
          productId: this.data.productId,
          fileLastModified: this.data.fileLastModified,
        },
        null,
        2,
      ),
    );
  }

  async doDownload(item: DownloadItemData, bearerToken: string): Promise<boolean> {
    const filename = normalizePathPart(item.filename, this.options.compat);
    const outFile = path.join(this.dir, filename);
    const apiChecksum = newestChecksum(item);

    if (this.options.dryRun) {
      console.log(`Dry run: ${this.name} - ${filename}`);
      return false;
    }

    if (existsSync(outFile)) {
      console.log(`File already exists: ${filename}`);
      const md5File = withSuffix(outFile, '.md5');

      if (apiChecksum && existsSync(md5File)) {
        const stored = (await readFile(md5File, 'utf8')).trim();
        if (stored === apiChecksum) {
          console.log(`Skipping ${this.name} - ${filename}`);
          return false;
        }
        console.log(`Checksum mismatch: ${filename}`);
      } else {
        const remoteTime = new Date(this.data.fileLastModified).getTime();
        const fileStat = await stat(outFile);
        if (remoteTime <= fileStat.mtimeMs) {
          console.log(`Skipping ${this.name} - ${filename}`);
          return false;
        }
        console.log(`File outdated: ${filename}`);
      }

      const oldDir = path.join(this.dir, 'old');
      await mkdir(oldDir, { recursive: true });
      const timestamp = new Date().toISOString().split('T')[0];
      console.log(`Moving ${filename} to old/`);
      await rename(outFile, path.join(oldDir, `${timestamp}-${filename}`));
    }

    await mkdir(this.dir, { recursive: true });

    let url: string;
    try {
      url = await this._prepareDownloadUrl(item, bearerToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Could not get download link for ${this.name} - ${filename}: ${msg}`);
      await this._logError(outFile, filename, '', msg);
      return false;
    }

    try {
      console.log(`Downloading ${this.name} - ${filename}`);
      await streamToFile(url, outFile);
      console.log(`Downloaded ${filename}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Download failed: ${this.name} - ${filename}: ${msg}`);
      await this._logError(outFile, filename, url, msg);
      return false;
    }

    if (apiChecksum) {
      const computed = await md5sum(outFile);
      const md5File = withSuffix(outFile, '.md5');
      await writeFile(md5File, computed);
      if (computed !== apiChecksum) {
        console.log(`Failed to verify ${filename}`);
      }
    }

    return true;
  }

  private async _prepareDownloadUrl(item: DownloadItemData, bearerToken: string): Promise<string> {
    const params = new URLSearchParams({
      siteId: SITE_ID,
      index: String(item.index),
      getChecksums: '0',
    });
    const headers: Record<string, string> = {
      Authorization: bearerToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    let r = await fetchWithRetry(
      `${API_BASE}order_products/${this.data.orderProductId}/prepare?${params}`,
      { headers },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    let data = (await r.json()) as { url: string; status: string };

    while (data.status.startsWith('Preparing')) {
      await sleep(POLL_INTERVAL_MS);
      r = await fetchWithRetry(
        `${API_BASE}order_products/${this.data.orderProductId}/check?${params}`,
        { headers },
      );
      if (!r.ok) throw new Error(`Poll failed: HTTP ${r.status}`);
      data = (await r.json()) as { url: string; status: string };
    }

    if (!data.url) throw new Error('No URL in prepare response');
    return data.url;
  }

  private async _logError(
    outFile: string,
    filename: string,
    url: string,
    detail: string,
  ): Promise<void> {
    const safeUrl = url.replace(/applicationKey=[^&]+/, 'applicationKey=REDACTED');
    await appendFile(
      path.join(this.outputDir, 'errors.txt'),
      [
        ` Cannot download: ${this.name}`,
        ` Path: ${outFile}`,
        ` File: ${filename}`,
        ` URL: ${safeUrl}`,
        ` ${detail}`,
        ` ---------------------------------------------------------\n`,
      ].join('\n'),
    );
  }
}

function newestChecksum(item: DownloadItemData): string | null {
  if (!Array.isArray(item.checksums) || item.checksums.length === 0) return null;
  const sorted = [...item.checksums].sort(
    (a, b) => new Date(b.checksumDate).getTime() - new Date(a.checksumDate).getTime(),
  );
  return sorted[0].checksum ?? null;
}

function withSuffix(filePath: string, newExt: string): string {
  const ext = path.extname(filePath);
  return ext ? filePath.slice(0, -ext.length) + newExt : filePath + newExt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
