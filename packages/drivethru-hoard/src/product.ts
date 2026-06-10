import { existsSync, readdirSync } from 'fs';
import { writeFile, readFile, mkdir, rename, unlink, appendFile, stat } from 'fs/promises';
import path, { dirname, relative } from 'path';

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
  deep?: boolean;
  logger: (msg: string) => void;
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

  async download(bearerToken: string): Promise<boolean> {
    if (this.data.files.length === 0) return false;
    if (!this.options.deep && hasFiles(this.dir)) return false;

    this.options.logger(`Downloading ${this.name}`);

    const filenameGroups = new Map<string, DownloadItemData[]>();
    for (const item of this.data.files) {
      const base = normalizePathPart(item.filename, this.options.compat);
      const key = base.toLowerCase();
      const arr = filenameGroups.get(key) ?? [];
      arr.push(item);
      filenameGroups.set(key, arr);
    }

    let wrote = 0;
    for (const item of this.data.files) {
      const base = normalizePathPart(item.filename, this.options.compat);
      const key = base.toLowerCase();
      const group = filenameGroups.get(key)!;
      const filename = group.length > 1 ? disambiguateFilename(base, item.index) : base;
      if (await this.doDownload(item, bearerToken, filename)) wrote++;
    }

    if (wrote === 0) return false;

    const manifestPath = path.join(
      this.outputDir,
      '.data',
      relative(this.outputDir, this.dir) + '.json',
    );
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
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

    return true;
  }

  async doDownload(
    item: DownloadItemData,
    bearerToken: string,
    filename: string,
  ): Promise<boolean> {
    const outFile = path.join(this.dir, filename);
    const apiChecksum = newestChecksum(item);

    if (this.options.dryRun) {
      this.options.logger(`Dry run: ${this.name} - ${filename}`);
      return false;
    }

    if (existsSync(outFile)) {
      this.options.logger(`File already exists: ${filename}`);
      const md5File = sidecarPath(this.outputDir, outFile);
      if (apiChecksum && existsSync(md5File)) {
        const stored = (await readFile(md5File, 'utf8')).trim();
        if (stored === apiChecksum) {
          this.options.logger(`Skipping ${this.name} - ${filename}`);
          return false;
        }
        this.options.logger(`Checksum mismatch: ${filename}`);
      } else {
        const remoteTime = new Date(this.data.fileLastModified).getTime();
        const fileStat = await stat(outFile);
        if (remoteTime <= fileStat.mtimeMs) {
          this.options.logger(`Skipping ${this.name} - ${filename}`);
          return false;
        }
        this.options.logger(`File outdated: ${filename}`);
      }

      const oldDir = path.join(this.dir, 'old');
      await mkdir(oldDir, { recursive: true });
      const timestamp = new Date().toISOString().split('T')[0];
      this.options.logger(`Moving ${filename} to old/`);
      await rename(outFile, path.join(oldDir, `${timestamp}-${filename}`));
    }

    await mkdir(this.dir, { recursive: true });

    let url: string;
    try {
      url = await this._prepareDownloadUrl(item, bearerToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger(`Could not get download link for ${this.name} - ${filename}: ${msg}`);
      await this._logError(outFile, filename, '', msg);
      return false;
    }

    try {
      this.options.logger(`Downloading ${this.name} - ${filename}`);
      const partialPath = outFile + '.partial';
      try {
        await streamToFile(url, partialPath);
        await rename(partialPath, outFile);
      } catch (e) {
        await unlink(partialPath).catch(() => {});
        throw e;
      }
      this.options.logger(`Downloaded ${filename}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger(`Download failed: ${this.name} - ${filename}: ${msg}`);
      await this._logError(outFile, filename, url, msg);
      return false;
    }

    if (apiChecksum) {
      const computed = await md5sum(outFile);
      if (computed !== apiChecksum) {
        const oldDir = path.join(this.dir, 'old');
        await mkdir(oldDir, { recursive: true });
        const timestamp = new Date().toISOString().split('T')[0];
        await rename(outFile, path.join(oldDir, `${timestamp}-${filename}`));
        this.options.logger(`Checksum mismatch after download: ${filename}`);
        await this._logError(outFile, filename, url, 'checksum mismatch after download');
        return false;
      }
      const md5File = sidecarPath(this.outputDir, outFile);
      await mkdir(dirname(md5File), { recursive: true });
      await writeFile(md5File, apiChecksum);
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
      3,
      this.options.logger,
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    let data = (await r.json()) as { url: string; status: string };

    while (data.status.startsWith('Preparing')) {
      await sleep(POLL_INTERVAL_MS);
      r = await fetchWithRetry(
        `${API_BASE}order_products/${this.data.orderProductId}/check?${params}`,
        { headers },
        3,
        this.options.logger,
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
      path.join(this.outputDir, '.data', 'errors.txt'),
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

function disambiguateFilename(filename: string, id: number | string): string {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return `${base}_${id}${ext}`;
}

function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((e) => !String(e).startsWith('.') && e !== 'old');
  } catch {
    return false;
  }
}

function newestChecksum(item: DownloadItemData): string | null {
  if (!Array.isArray(item.checksums) || item.checksums.length === 0) return null;
  const sorted = [...item.checksums].sort(
    (a, b) => new Date(b.checksumDate).getTime() - new Date(a.checksumDate).getTime(),
  );
  return sorted[0].checksum?.toLowerCase() ?? null;
}

function sidecarPath(outputDir: string, filePath: string): string {
  const rel = relative(outputDir, filePath);
  return path.join(outputDir, '.data', rel + '.md5');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
