import { existsSync, readdirSync } from 'fs';
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, relative } from 'path';

import type { RunTask } from '@irrg/hoard-core';

import { fetchBundlePage, type DownloadFile } from './bundle.js';
import { type BundleRef } from './cabinet.js';
import { cleanPath, md5sum, runConcurrently, streamToFile } from './utils.js';

export interface LibraryOptions {
  outputDir: string;
  jobs: number;
  dryRun: boolean;
  cookie: string;
  filters: string[];
  deep?: boolean;
  logger?: (msg: string) => void;
  onProgress?: (done: number, total: number, downloaded: number) => void;
  onLoadPage?: (loaded: number, total: number, filesFound: number) => void;
  runTask?: RunTask;
}

export class Library {
  private outputDir: string;
  private jobs: number;
  private dryRun: boolean;
  private cookie: string;
  private filters: string[];
  private deep: boolean;
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;
  private onLoadPage?: (loaded: number, total: number, filesFound: number) => void;
  private runTask?: RunTask;

  constructor(opts: LibraryOptions) {
    this.outputDir = opts.outputDir;
    this.jobs = opts.jobs;
    this.dryRun = opts.dryRun;
    this.cookie = opts.cookie;
    this.filters = opts.filters.map((f) => f.toLowerCase());
    this.deep = opts.deep ?? false;
    this.logger = opts.logger ?? (() => {});
    this.onProgress = opts.onProgress;
    this.runTask = opts.runTask;
    this.onLoadPage = opts.onLoadPage;
  }

  private matchesFilter(filename: string): boolean {
    if (this.filters.length === 0) return true;
    const lower = filename.toLowerCase();
    return this.filters.some((f) => lower.includes(f));
  }

  private async _loadBundlePage(key: string): Promise<import('./bundle.js').BundlePage> {
    const cachePath = join(this.outputDir, '.data', 'bundles', `${key}.json`);
    if (!this.deep && existsSync(cachePath)) {
      try {
        return JSON.parse(await readFile(cachePath, 'utf-8')) as import('./bundle.js').BundlePage;
      } catch {}
    }
    const page = await fetchBundlePage(key, this.cookie);
    if (!this.dryRun) {
      try {
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, JSON.stringify(page, null, 2));
      } catch {}
    }
    return page;
  }

  async downloadBundles(bundles: BundleRef[]): Promise<{ downloaded: number; errors: number }> {
    type BundleEntry = { title: string; dir: string; files: DownloadFile[]; skip: boolean };
    const entries: BundleEntry[] = [];

    let pagesLoaded = 0;
    await Promise.all(
      bundles.map(async (ref) => {
        const page = await this._loadBundlePage(ref.key);
        const dir = join(this.outputDir, cleanPath(page.title));
        const skip = !this.deep && hasFiles(dir);
        const files = page.files.filter((f) => this.matchesFilter(f.filename));
        if (files.length > 0) entries.push({ title: page.title, dir, files, skip });
        pagesLoaded++;
        const filesFound = entries.reduce((s, e) => s + e.files.length, 0);
        this.onLoadPage?.(pagesLoaded, bundles.length, filesFound);
      }),
    );

    const total = entries.reduce((s, e) => s + e.files.length, 0);
    let filesDone = 0;
    let downloaded = 0;
    let errors = 0;

    this.onProgress?.(0, total, 0);

    for (const { title, dir, files, skip } of entries) {
      if (skip) {
        filesDone += files.length;
        this.onProgress?.(filesDone, total, downloaded);
        continue;
      }

      this.logger(`Downloading ${title}`);
      if (!this.dryRun) await mkdir(dir, { recursive: true });

      const filenameGroups = new Map<string, DownloadFile[]>();
      for (const f of files) {
        const key = f.filename.toLowerCase();
        const arr = filenameGroups.get(key) ?? [];
        arr.push(f);
        filenameGroups.set(key, arr);
      }

      let bundleHadNewFiles = false;
      const tasks = files.map((f) => async () => {
        const key = f.filename.toLowerCase();
        const group = filenameGroups.get(key)!;
        const idx = group.indexOf(f);
        const filename = group.length > 1 ? disambiguateFilename(f.filename, idx + 1) : f.filename;
        const result = await this.downloadFile(title, dir, f, filename);
        if (result === 'downloaded') bundleHadNewFiles = true;
        if (result === 'error') errors++;
        this.onProgress?.(++filesDone, total, downloaded);
      });

      if (this.runTask) {
        await Promise.all(tasks.map((task) => this.runTask!(task)));
      } else {
        await runConcurrently(tasks, this.jobs);
      }
      if (bundleHadNewFiles) downloaded++;
    }

    return { downloaded, errors };
  }

  async listBundles(bundles: BundleRef[]): Promise<void> {
    for (const ref of bundles) {
      const page = await this._loadBundlePage(ref.key);
      const files = page.files.filter((f) => this.matchesFilter(f.filename));
      if (files.length === 0) continue;
      this.logger(`\n${page.title} [${ref.key}]`);
      for (const f of files) {
        this.logger(`  ${f.filename}`);
      }
    }
  }

  private async downloadFile(
    bundleName: string,
    dir: string,
    file: DownloadFile,
    filename: string,
  ): Promise<'downloaded' | 'skipped' | 'error'> {
    const outPath = join(dir, filename);
    const sidePath = sidecarPath(this.outputDir, outPath);

    try {
      if (existsSync(outPath)) {
        this.logger(`File already exists: ${filename}`);
        if (file.md5) {
          if (existsSync(sidePath)) {
            const stored = (await readFile(sidePath, 'utf8')).trim();
            if (stored === file.md5) {
              this.logger(`Skipping ${bundleName} - ${filename}`);
              return 'skipped';
            }
          } else {
            const actual = await md5sum(outPath);
            if (actual === file.md5) {
              await mkdir(dirname(sidePath), { recursive: true });
              await writeFile(sidePath, file.md5);
              this.logger(`Skipping ${bundleName} - ${filename}`);
              return 'skipped';
            }
          }
          this.logger(`Checksum mismatch: ${filename}`);
          if (!this.dryRun) {
            const oldDir = join(dir, 'old');
            await mkdir(oldDir, { recursive: true });
            this.logger(`Moving ${filename} to old/`);
            const timestamp = new Date().toISOString().split('T')[0];
            await rename(outPath, join(oldDir, `${timestamp}-${filename}`));
          }
        } else {
          this.logger(`Skipping ${bundleName} - ${filename}`);
          return 'skipped';
        }
      }

      if (this.dryRun) {
        this.logger(`Dry run: ${bundleName} - ${filename}`);
        return 'skipped';
      }

      this.logger(`Downloading ${filename}`);
      const partialPath = outPath + '.partial';
      try {
        await streamToFile(file.url, partialPath, this.cookie);
        await rename(partialPath, outPath);
      } catch (e) {
        await unlink(partialPath).catch(() => {});
        throw e;
      }
      this.logger(`Downloaded ${filename}`);

      if (file.md5) {
        const actual = await md5sum(outPath);
        if (actual !== file.md5) {
          const oldDir = join(dir, 'old');
          await mkdir(oldDir, { recursive: true });
          const timestamp = new Date().toISOString().split('T')[0];
          await rename(outPath, join(oldDir, `${timestamp}-${filename}`));
          this.logger(`Checksum mismatch after download: ${filename}`);
          const dataDir = join(this.outputDir, '.data');
          await mkdir(dataDir, { recursive: true });
          await appendFile(
            join(dataDir, 'errors.txt'),
            `${bundleName} - ${filename}: checksum mismatch after download\n`,
          );
          return 'error';
        }
        await mkdir(dirname(sidePath), { recursive: true });
        await writeFile(sidePath, file.md5);
      }

      return 'downloaded';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger(`Download failed: ${bundleName} - ${filename}: ${msg}`);
      const dataDir = join(this.outputDir, '.data');
      await mkdir(dataDir, { recursive: true });
      await appendFile(join(dataDir, 'errors.txt'), `${bundleName} - ${filename}: ${msg}\n`);
      return 'error';
    }
  }
}

function disambiguateFilename(filename: string, id: number | string): string {
  const ext = extname(filename);
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

function sidecarPath(outputDir: string, filePath: string): string {
  const rel = relative(outputDir, filePath);
  return join(outputDir, '.data', rel + '.md5');
}
