import { existsSync, readdirSync } from 'fs';
import { writeFile, readFile, mkdir, rename, unlink, appendFile } from 'fs/promises';
import path from 'path';

import { streamToFile, md5sum, cleanPath, runConcurrently } from './utils.js';

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

export interface BundleWorkItem {
  item: DownloadStructItem;
  subDir: string;
  productName: string;
  filename: string;
}

export class Bundle {
  key: string;
  name: string;
  title: string;
  subproducts: SubProduct[];
  private outputDir: string;
  options: BundleOptions;

  constructor(key: string, data: BundleData, options: BundleOptions) {
    this.key = key;
    this.name = data.product?.human_name ?? key;
    this.title = cleanPath(this.name);
    this.subproducts = Array.isArray(data.subproducts) ? data.subproducts : [];
    this.outputDir = options.outputDir;
    this.options = options;
  }

  get dir(): string {
    return path.join(this.outputDir, this.title);
  }

  workItems(): BundleWorkItem[] {
    const filters = (this.options.filters ?? []).map((f) => f.toLowerCase());
    const subproducts = filters.length
      ? this.subproducts.filter((s) => filters.some((f) => s.human_name.toLowerCase().includes(f)))
      : this.subproducts;

    type RawItem = {
      item: DownloadStructItem;
      subDir: string;
      productName: string;
      rawFilename: string;
    };
    const raw: RawItem[] = [];

    for (const sub of subproducts) {
      const subDir = path.join(this.dir, cleanPath(sub.human_name));
      for (const dl of sub.downloads) {
        if (
          this.options.platform &&
          dl.platform.toLowerCase() !== this.options.platform.toLowerCase()
        )
          continue;
        for (const item of Array.isArray(dl.download_struct) ? dl.download_struct : []) {
          if (item.url?.web) {
            const rawFilename = filenameFromUrl(item.url.web);
            if (rawFilename) raw.push({ item, subDir, productName: sub.human_name, rawFilename });
          }
        }
      }
    }

    const groups = new Map<string, RawItem[]>();
    for (const r of raw) {
      const key = `${r.subDir}::${r.rawFilename.toLowerCase()}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }

    return raw.map((r) => {
      const key = `${r.subDir}::${r.rawFilename.toLowerCase()}`;
      const group = groups.get(key)!;
      const idx = group.indexOf(r);
      const filename =
        group.length > 1 ? disambiguateFilename(r.rawFilename, idx + 1) : r.rawFilename;
      return { item: r.item, subDir: r.subDir, productName: r.productName, filename };
    });
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
    jobs = 1,
  ): Promise<{ newFiles: number; errors: number }> {
    const work = this.workItems();
    if (!this.options.deep && hasFiles(this.dir)) {
      for (const _ of work) onFile?.('skipped');
      return { newFiles: 0, errors: 0 };
    }
    let newFiles = 0;
    let errors = 0;
    const tasks = work.map(({ item, subDir, productName, filename }) => async () => {
      const result = await this.doDownload(item, subDir, productName, filename);
      onFile?.(result);
      if (result === 'downloaded') newFiles++;
      else if (result === 'error') errors++;
    });
    await runConcurrently(tasks, jobs);
    return { newFiles, errors };
  }

  async doDownload(
    item: DownloadStructItem,
    dir: string,
    productName: string,
    filename: string,
  ): Promise<'downloaded' | 'skipped' | 'error'> {
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
        if (existsSync(md5File) && !this.options.deep) {
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
        const oldDir = path.join(dir, 'old');
        await mkdir(oldDir, { recursive: true });
        const stamp = `${new Date().toISOString().slice(0, 23).replace(/[:.]/g, '-')}-${Math.floor(
          Math.random() * 0x10000,
        )
          .toString(16)
          .padStart(4, '0')}`;
        await rename(outFile, path.join(oldDir, `${stamp}-${filename}`));
      } else {
        this.options.logger(`Skipping ${productName} - ${filename}`);
        return 'skipped';
      }
    }

    await mkdir(dir, { recursive: true });

    this.options.logger(`Downloading ${this.name} / ${productName} - ${filename}`);
    const partialPath = outFile + '.partial';
    const errorsFile = path.join(this.outputDir, '.data', 'errors.txt');
    try {
      await streamToFile(item.url.web, partialPath, `_simpleauth_sess=${this.options.cookie}`);
    } catch (e) {
      await unlink(partialPath).catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      this.options.logger(`Download failed: ${productName} - ${filename}: ${msg}`);
      await mkdir(path.dirname(errorsFile), { recursive: true });
      await appendFile(
        errorsFile,
        `Cannot download: ${this.name} / ${productName} - ${filename}\n  URL: ${item.url.web}\n  ${msg}\n---\n`,
      );
      return 'error';
    }
    this.options.logger(`Downloaded ${filename}`);

    const apiMd5 = item.md5?.toLowerCase() || null;
    if (apiMd5) {
      const computed = await md5sum(partialPath);
      if (computed !== apiMd5) {
        await unlink(partialPath).catch(() => {});
        this.options.logger(`Checksum mismatch after download: ${filename}`);
        await mkdir(path.dirname(errorsFile), { recursive: true });
        await appendFile(
          errorsFile,
          `Checksum mismatch: ${this.name} / ${productName} - ${filename}\n  URL: ${item.url.web}\n---\n`,
        );
        return 'error';
      }
    }

    await rename(partialPath, outFile);

    if (apiMd5) {
      const md5Out = sidecarPath(this.outputDir, outFile);
      await mkdir(path.dirname(md5Out), { recursive: true });
      await writeFile(md5Out, apiMd5);
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

function filenameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return url.split('?')[0].split('/').pop() ?? '';
  }
}

function sidecarPath(outputDir: string, filePath: string): string {
  const rel = path.relative(outputDir, filePath);
  return path.join(outputDir, '.data', rel + '.md5');
}
