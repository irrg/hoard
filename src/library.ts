import { existsSync } from "fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { fetchBundlePage, type DownloadFile } from "./bundle.js";
import { type BundleRef } from "./cabinet.js";
import { cleanPath, md5sum, runConcurrently, streamToFile } from "./utils.js";

interface LibraryOptions {
  outputDir: string;
  jobs: number;
  dryRun: boolean;
  cookie: string;
  filters: string[];
}

export class Library {
  private outputDir: string;
  private jobs: number;
  private dryRun: boolean;
  private cookie: string;
  private filters: string[];

  constructor(opts: LibraryOptions) {
    this.outputDir = opts.outputDir;
    this.jobs = opts.jobs;
    this.dryRun = opts.dryRun;
    this.cookie = opts.cookie;
    this.filters = opts.filters.map((f) => f.toLowerCase());
  }

  private matchesFilter(filename: string): boolean {
    if (this.filters.length === 0) return true;
    const lower = filename.toLowerCase();
    return this.filters.some((f) => lower.includes(f));
  }

  async downloadBundles(bundles: BundleRef[]): Promise<void> {
    let done = 0;
    let errors = 0;

    for (const ref of bundles) {
      const page = await fetchBundlePage(ref.key, this.cookie);
      const dir = join(this.outputDir, cleanPath(page.title));
      const files = page.files.filter((f) => this.matchesFilter(f.filename));

      if (files.length === 0) continue;

      console.log("Downloading", page.title);

      if (!this.dryRun) await mkdir(dir, { recursive: true });

      const tasks = files.map((f) => async () => {
        const ok = await this.downloadFile(page.title, dir, f);
        if (ok) done++; else errors++;
      });

      await runConcurrently(tasks, this.jobs);
    }

    console.log(`Downloaded ${done} files, ${errors} errors`);
  }

  async listBundles(bundles: BundleRef[]): Promise<void> {
    for (const ref of bundles) {
      const page = await fetchBundlePage(ref.key, this.cookie);
      const files = page.files.filter((f) => this.matchesFilter(f.filename));
      if (files.length === 0) continue;
      console.log(`\n${page.title} [${ref.key}]`);
      for (const f of files) {
        console.log(`  ${f.filename}`);
      }
    }
  }

  private async downloadFile(
    bundleName: string,
    dir: string,
    file: DownloadFile,
  ): Promise<boolean> {
    const outPath = join(dir, file.filename);
    const sidecarPath = outPath + ".md5";

    try {
      if (existsSync(outPath)) {
        console.log(`File already exists: ${file.filename}`);
        if (file.md5) {
          if (existsSync(sidecarPath)) {
            const stored = (await readFile(sidecarPath, "utf8")).trim();
            if (stored === file.md5) {
              console.log(`Skipping ${bundleName} - ${file.filename}`);
              return true;
            }
          } else {
            const actual = await md5sum(outPath);
            if (actual === file.md5) {
              await writeFile(sidecarPath, file.md5);
              console.log(`Skipping ${bundleName} - ${file.filename}`);
              return true;
            }
          }
          console.log(`Checksum mismatch: ${file.filename}`);
          const oldDir = join(dir, "old");
          await mkdir(oldDir, { recursive: true });
          console.log(`Moving ${file.filename} to old/`);
          await rename(outPath, join(oldDir, file.filename));
        } else {
          console.log(`Skipping ${bundleName} - ${file.filename}`);
          return true;
        }
      }

      if (this.dryRun) {
        console.log(`Dry run: ${bundleName} - ${file.filename}`);
        return true;
      }

      console.log(`Downloading ${file.filename}`);
      await streamToFile(file.url, outPath);
      console.log(`Downloaded ${file.filename}`);

      if (file.md5) {
        const actual = await md5sum(outPath);
        await writeFile(sidecarPath, actual);
        if (actual !== file.md5) {
          console.log(`Failed to verify ${file.filename}`);
        }
      }

      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Download failed: ${bundleName} - ${file.filename}: ${msg}`);
      await appendFile(join(this.outputDir, "errors.txt"), `${bundleName} - ${file.filename}: ${msg}\n`);
      return false;
    }
  }
}
