import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';

import { fetchBundlePage, type DownloadFile } from './bundle.js';
import { type BundleRef } from './cabinet.js';
import { cleanPath, md5sum, runConcurrently, streamToFile } from './utils.js';

export interface LibraryOptions {
  outputDir: string;
  jobs: number;
  dryRun: boolean;
  cookie: string;
  filters: string[];
  logger?: (msg: string) => void;
  onProgress?: (done: number, total: number, downloaded: number) => void;
}

export class Library {
  private outputDir: string;
  private jobs: number;
  private dryRun: boolean;
  private cookie: string;
  private filters: string[];
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;

  constructor(opts: LibraryOptions) {
    this.outputDir = opts.outputDir;
    this.jobs = opts.jobs;
    this.dryRun = opts.dryRun;
    this.cookie = opts.cookie;
    this.filters = opts.filters.map((f) => f.toLowerCase());
    this.logger = opts.logger ?? (() => {});
    this.onProgress = opts.onProgress;
  }

  private matchesFilter(filename: string): boolean {
    if (this.filters.length === 0) return true;
    const lower = filename.toLowerCase();
    return this.filters.some((f) => lower.includes(f));
  }

  async downloadBundles(bundles: BundleRef[]): Promise<{ downloaded: number; errors: number }> {
    const total = bundles.length;
    let downloaded = 0;
    let errors = 0;
    let processed = 0;

    for (const ref of bundles) {
      const page = await fetchBundlePage(ref.key, this.cookie);
      const dir = join(this.outputDir, cleanPath(page.title));
      const files = page.files.filter((f) => this.matchesFilter(f.filename));

      if (files.length === 0) {
        this.onProgress?.(++processed, total, downloaded);
        continue;
      }

      this.logger(`Downloading ${page.title}`);
      if (!this.dryRun) await mkdir(dir, { recursive: true });

      let bundleHadNewFiles = false;
      const tasks = files.map((f) => async () => {
        const result = await this.downloadFile(page.title, dir, f);
        if (result === 'downloaded') bundleHadNewFiles = true;
        if (result === 'error') errors++;
      });

      await runConcurrently(tasks, this.jobs);
      if (bundleHadNewFiles) downloaded++;
      this.onProgress?.(++processed, total, downloaded);
    }

    return { downloaded, errors };
  }

  async listBundles(bundles: BundleRef[]): Promise<void> {
    for (const ref of bundles) {
      const page = await fetchBundlePage(ref.key, this.cookie);
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
  ): Promise<'downloaded' | 'skipped' | 'error'> {
    const outPath = join(dir, file.filename);
    const sidecarPath = outPath + '.md5';

    try {
      if (existsSync(outPath)) {
        this.logger(`File already exists: ${file.filename}`);
        if (file.md5) {
          if (existsSync(sidecarPath)) {
            const stored = (await readFile(sidecarPath, 'utf8')).trim();
            if (stored === file.md5) {
              this.logger(`Skipping ${bundleName} - ${file.filename}`);
              return 'skipped';
            }
          } else {
            const actual = await md5sum(outPath);
            if (actual === file.md5) {
              await writeFile(sidecarPath, file.md5);
              this.logger(`Skipping ${bundleName} - ${file.filename}`);
              return 'skipped';
            }
          }
          this.logger(`Checksum mismatch: ${file.filename}`);
          if (!this.dryRun) {
            const oldDir = join(dir, 'old');
            await mkdir(oldDir, { recursive: true });
            this.logger(`Moving ${file.filename} to old/`);
            const timestamp = new Date().toISOString().split('T')[0];
            await rename(outPath, join(oldDir, `${timestamp}-${file.filename}`));
          }
        } else {
          this.logger(`Skipping ${bundleName} - ${file.filename}`);
          return 'skipped';
        }
      }

      if (this.dryRun) {
        this.logger(`Dry run: ${bundleName} - ${file.filename}`);
        return 'skipped';
      }

      this.logger(`Downloading ${file.filename}`);
      await streamToFile(file.url, outPath);
      this.logger(`Downloaded ${file.filename}`);

      if (file.md5) {
        const actual = await md5sum(outPath);
        await writeFile(sidecarPath, actual);
        if (actual !== file.md5) {
          this.logger(`Failed to verify ${file.filename}`);
        }
      }

      return 'downloaded';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger(`Download failed: ${bundleName} - ${file.filename}: ${msg}`);
      await appendFile(
        join(this.outputDir, 'errors.txt'),
        `${bundleName} - ${file.filename}: ${msg}\n`,
      );
      return 'error';
    }
  }
}
