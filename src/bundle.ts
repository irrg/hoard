import { existsSync, readdirSync } from 'fs';
import { writeFile, readFile, mkdir, rename, appendFile } from 'fs/promises';
import path from 'path';

import { streamToFile, md5sum, cleanPath } from './utils.js';

export interface DownloadStructItem {
  url: { web: string; bittorrent?: string };
  md5?: string;
  name?: string;
  file_size?: number;
}

export interface SubProductDownload {
  platform: string;
  download_struct: DownloadStructItem[];
}

export interface SubProduct {
  human_name: string;
  downloads: SubProductDownload[];
}

export interface BundleData {
  product: { human_name: string };
  subproducts: SubProduct[];
}

export interface BundleOptions {
  cookie: string;
  outputDir: string;
  platform?: string;
  extInclude: string[];
  extExclude: string[];
  dryRun: boolean;
  filters: string[];
  logger: (msg: string) => void;
  deep?: boolean;
}

export class Bundle {
  key: string;
  name: string;
  title: string;
  subproducts: SubProduct[];
  private outputDir: string;
  private options: BundleOptions;

  constructor(key: string, data: BundleData, options: BundleOptions) {
    this.key = key;
    this.name = data.product?.human_name ?? key;
    this.title = cleanPath(this.name);
    this.subproducts = Array.isArray(data.subproducts) ? data.subproducts : [];
    this.outputDir = options.outputDir;
    this.options = options;
  }

  totalFiles(): number {
    return this.subproducts.reduce(
      (sum, sub) =>
        sum +
        sub.downloads.reduce((s, dl) => {
          const items = Array.isArray(dl.download_struct) ? dl.download_struct : [];
          return s + items.filter((i) => i.url?.web).length;
        }, 0),
      0,
    );
  }

  async download(
    onFile?: (result: 'downloaded' | 'skipped' | 'error') => void,
  ): Promise<{ newFiles: number; errors: number }> {
    const bundleDir = path.join(this.outputDir, this.title);
    if (!this.options.deep && hasFiles(bundleDir)) return { newFiles: 0, errors: 0 };
    const filters = (this.options.filters ?? []).map((f) => f.toLowerCase());
    const subproducts = filters.length
      ? this.subproducts.filter((s) => filters.some((f) => s.human_name.toLowerCase().includes(f)))
      : this.subproducts;
    let newFiles = 0;
    let errors = 0;
    for (const sub of subproducts) {
      const subDir = path.join(bundleDir, cleanPath(sub.human_name));
      for (const dl of sub.downloads) {
        if (this.options.platform) {
          if (dl.platform.toLowerCase() !== this.options.platform.toLowerCase()) continue;
        }
        const items = Array.isArray(dl.download_struct) ? dl.download_struct : [];
        for (const item of items) {
          if (item.url?.web) {
            const result = await this.doDownload(item, subDir, sub.human_name);
            onFile?.(result);
            if (result === 'downloaded') newFiles++;
            else if (result === 'error') errors++;
          }
        }
      }
    }
    return { newFiles, errors };
  }

  private async doDownload(
    item: DownloadStructItem,
    dir: string,
    productName: string,
  ): Promise<'downloaded' | 'skipped' | 'error'> {
    const filename = filenameFromUrl(item.url.web);
    if (!filename) return 'error';

    if (!this.shouldDownloadExt(filename)) {
      this.options.logger(`Skipping ${productName} - ${filename} (extension filtered)`);
      return 'skipped';
    }

    const outFile = path.join(dir, filename);

    if (this.options.dryRun) {
      this.options.logger(`Dry run: ${this.name} / ${productName} - ${filename}`);
      return 'skipped';
    }

    if (existsSync(outFile)) {
      const apiMd5 = item.md5?.toLowerCase() || null;
      if (apiMd5) {
        const md5File = sidecarPath(this.outputDir, outFile);
        if (existsSync(md5File)) {
          const stored = (await readFile(md5File, 'utf8')).trim();
          if (stored === apiMd5) {
            this.options.logger(`Skipping ${productName} - ${filename}`);
            return 'skipped';
          }
        } else {
          const computed = await md5sum(outFile);
          if (computed === apiMd5) {
            await mkdir(path.dirname(md5File), { recursive: true });
            await writeFile(md5File, apiMd5);
            this.options.logger(`Skipping ${productName} - ${filename}`);
            return 'skipped';
          }
        }
        this.options.logger(`Checksum mismatch: ${filename}, re-downloading`);
        const oldDir = path.join(
          this.outputDir,
          '.data',
          path.relative(this.outputDir, dir),
          'old',
        );
        await mkdir(oldDir, { recursive: true });
        const stamp = new Date().toISOString().split('T')[0];
        await rename(outFile, path.join(oldDir, `${stamp}-${filename}`));
      } else {
        this.options.logger(`Skipping ${productName} - ${filename}`);
        return 'skipped';
      }
    }

    await mkdir(dir, { recursive: true });

    try {
      this.options.logger(`Downloading ${this.name} / ${productName} - ${filename}`);
      await streamToFile(item.url.web, outFile, this.options.cookie);
      this.options.logger(`Downloaded ${filename}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger(`Download failed: ${productName} - ${filename}: ${msg}`);
      await appendFile(
        path.join(this.outputDir, '.data', 'errors.txt'),
        `Cannot download: ${this.name} / ${productName} - ${filename}\n  URL: ${item.url.web}\n  ${msg}\n---\n`,
      );
      return 'error';
    }

    const apiMd5 = item.md5 || null;
    if (apiMd5) {
      const computed = await md5sum(outFile);
      const md5Out = sidecarPath(this.outputDir, outFile);
      await mkdir(path.dirname(md5Out), { recursive: true });
      await writeFile(md5Out, apiMd5);
      if (computed !== apiMd5) {
        this.options.logger(`MD5 mismatch after download: ${filename}`);
      }
    }

    return 'downloaded';
  }

  private shouldDownloadExt(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (this.options.extInclude.length > 0) return this.options.extInclude.includes(ext);
    if (this.options.extExclude.length > 0) return !this.options.extExclude.includes(ext);
    return true;
  }
}

function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((e) => !String(e).startsWith('.'));
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return url.split('?')[0].split('/').pop() ?? '';
  }
}

function sidecarPath(outputDir: string, filePath: string): string {
  const rel = path.relative(outputDir, filePath);
  const ext = path.extname(rel);
  const base = ext ? rel.slice(0, -ext.length) : rel;
  return path.join(outputDir, '.data', base + '.md5');
}
