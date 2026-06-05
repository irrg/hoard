import { writeFile, readFile, mkdir, rename, appendFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { streamToFile, md5sum, cleanPath } from "./utils.js";

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
}

export class Bundle {
  key: string;
  title: string;
  subproducts: SubProduct[];
  private outputDir: string;
  private options: BundleOptions;

  constructor(key: string, data: BundleData, options: BundleOptions) {
    this.key = key;
    this.title = cleanPath(data.product?.human_name ?? key);
    this.subproducts = Array.isArray(data.subproducts) ? data.subproducts : [];
    this.outputDir = options.outputDir;
    this.options = options;
  }

  async download(): Promise<void> {
    const bundleDir = path.join(this.outputDir, this.title);
    for (const sub of this.subproducts) {
      const subDir = path.join(bundleDir, cleanPath(sub.human_name));
      for (const dl of sub.downloads) {
        if (this.options.platform) {
          if (dl.platform.toLowerCase() !== this.options.platform.toLowerCase()) continue;
        }
        const items = Array.isArray(dl.download_struct) ? dl.download_struct : [];
        for (const item of items) {
          if (item.url?.web) {
            await this.doDownload(item, subDir, sub.human_name);
          }
        }
      }
    }
  }

  private async doDownload(
    item: DownloadStructItem,
    dir: string,
    productName: string,
  ): Promise<boolean> {
    const filename = filenameFromUrl(item.url.web);
    if (!filename) return false;

    if (!this.shouldDownloadExt(filename)) {
      console.log(`Skipping ${productName} - ${filename} (extension filtered)`);
      return false;
    }

    const outFile = path.join(dir, filename);

    if (this.options.dryRun) {
      console.log(`Dry run: ${this.title} / ${productName} - ${filename}`);
      return false;
    }

    if (existsSync(outFile)) {
      const apiMd5 = item.md5 || null;
      if (apiMd5) {
        const md5File = withMd5Suffix(outFile);
        if (existsSync(md5File)) {
          const stored = (await readFile(md5File, "utf8")).trim();
          if (stored === apiMd5) {
            console.log(`Skipping ${productName} - ${filename}`);
            return false;
          }
        } else {
          const computed = await md5sum(outFile);
          if (computed === apiMd5) {
            await writeFile(md5File, apiMd5);
            console.log(`Skipping ${productName} - ${filename}`);
            return false;
          }
        }
        console.log(`Checksum mismatch: ${filename}, re-downloading`);
        const oldDir = path.join(dir, "old");
        await mkdir(oldDir, { recursive: true });
        const stamp = new Date().toISOString().split("T")[0];
        await rename(outFile, path.join(oldDir, `${stamp}-${filename}`));
      } else {
        console.log(`Skipping ${productName} - ${filename}`);
        return false;
      }
    }

    await mkdir(dir, { recursive: true });

    try {
      console.log(`Downloading ${this.title} / ${productName} - ${filename}`);
      await streamToFile(item.url.web, outFile, this.options.cookie);
      console.log(`Downloaded ${filename}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Download failed: ${productName} - ${filename}: ${msg}`);
      await appendFile(
        path.join(this.outputDir, "errors.txt"),
        `Cannot download: ${this.title} / ${productName} - ${filename}\n  URL: ${item.url.web}\n  ${msg}\n---\n`,
      );
      return false;
    }

    const apiMd5 = item.md5 || null;
    if (apiMd5) {
      const computed = await md5sum(outFile);
      if (computed !== apiMd5) {
        console.log(`MD5 mismatch after download: ${filename}`);
      } else {
        await writeFile(withMd5Suffix(outFile), apiMd5);
      }
    }

    return true;
  }

  private shouldDownloadExt(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (this.options.extInclude.length > 0) return this.options.extInclude.includes(ext);
    if (this.options.extExclude.length > 0) return !this.options.extExclude.includes(ext);
    return true;
  }
}

function filenameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    return url.split("?")[0].split("/").pop() ?? "";
  }
}

function withMd5Suffix(filePath: string): string {
  const ext = path.extname(filePath);
  return ext ? filePath.slice(0, -ext.length) + ".md5" : filePath + ".md5";
}
