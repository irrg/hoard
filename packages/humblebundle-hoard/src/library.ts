import { existsSync, readdirSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import type { RunTask } from '@irrg/hoard-core';

import { Bundle, BundleData, BundleOptions } from './bundle.js';
import { fetchWithRetry, runConcurrently } from './utils.js';

const BASE_URL = 'https://www.humblebundle.com';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LibraryOptions {
  cookie: string;
  outputDir: string;
  jobs: number;
  platform?: string;
  extInclude: string[];
  extExclude: string[];
  dryRun: boolean;
  filters: string[];
  logger?: (msg: string) => void;
  onProgress?: (done: number, total: number, downloaded: number) => void;
  deep?: boolean;
  runTask?: RunTask;
}

interface CachedOrder {
  fetchedAt: string;
  data: BundleData;
}

export class Library {
  private cookie: string;
  private jobs: number;
  private bundleOptions: BundleOptions;
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;
  private runTask?: RunTask;
  bundles: Bundle[];

  constructor(options: LibraryOptions) {
    this.cookie = options.cookie;
    this.jobs = options.jobs;
    this.bundles = [];
    this.logger = options.logger ?? (() => {});
    this.onProgress = options.onProgress;
    this.runTask = options.runTask;
    this.bundleOptions = {
      cookie: options.cookie,
      outputDir: options.outputDir,
      platform: options.platform,
      extInclude: options.extInclude,
      extExclude: options.extExclude,
      dryRun: options.dryRun,
      filters: options.filters,
      logger: this.logger,
      deep: options.deep,
    };
  }

  private get authHeaders(): Record<string, string> {
    return {
      Cookie: `_simpleauth_sess=${this.cookie}`,
      Accept: 'application/json',
    };
  }

  private ordersDir(): string {
    return join(this.bundleOptions.outputDir, '.data', 'orders');
  }

  private orderCachePath(key: string): string {
    return join(this.ordersDir(), `${key}.json`);
  }

  private async loadCachedOrder(key: string): Promise<BundleData | null> {
    try {
      const raw = await readFile(this.orderCachePath(key), 'utf-8');
      const cached = JSON.parse(raw) as CachedOrder;
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age > CACHE_TTL_MS) return null;
      return cached.data;
    } catch {
      return null;
    }
  }

  private async saveCachedOrder(key: string, data: BundleData): Promise<void> {
    await mkdir(this.ordersDir(), { recursive: true });
    const entry: CachedOrder = { fetchedAt: new Date().toISOString(), data };
    await writeFile(this.orderCachePath(key), JSON.stringify(entry, null, 2), 'utf-8');
  }

  private async fetchKeys(): Promise<string[]> {
    const r = await fetchWithRetry(
      `${BASE_URL}/api/v1/user/order`,
      { headers: this.authHeaders },
      3,
      this.logger,
    );
    if (!r.ok) throw new Error(`Failed to fetch orders: HTTP ${r.status}`);
    const data = (await r.json()) as { gamekey: string }[];
    return Array.isArray(data) ? data.map((d) => d.gamekey) : [];
  }

  private async fetchBundles(keys: string[]): Promise<number> {
    let failed = 0;
    const tasks = keys.map((key) => async () => {
      const cached = this.bundleOptions.deep ? null : await this.loadCachedOrder(key);
      if (cached) {
        this.bundles.push(new Bundle(key, cached, this.bundleOptions));
        return;
      }
      const r = await fetchWithRetry(
        `${BASE_URL}/api/v1/order/${key}?all_tpkds=true`,
        { headers: this.authHeaders },
        3,
        this.logger,
      );
      if (!r.ok) {
        this.logger(`Failed to fetch order ${key}: HTTP ${r.status}`);
        failed++;
        return;
      }
      try {
        const data = (await r.json()) as BundleData;
        await this.saveCachedOrder(key, data).catch((e) => {
          this.logger(`Failed to cache order ${key}: ${e instanceof Error ? e.message : e}`);
        });
        this.bundles.push(new Bundle(key, data, this.bundleOptions));
      } catch {
        this.logger(`Failed to parse order ${key}`);
        failed++;
      }
    });
    if (this.runTask) {
      await Promise.all(tasks.map((t) => this.runTask!(t)));
    } else {
      await runConcurrently(tasks, this.jobs);
    }
    return failed;
  }

  async loadOrders(keys?: string[]): Promise<{ failed: number }> {
    const allKeys = keys ?? (await this.fetchKeys());
    this.logger(`Found ${allKeys.length} orders`);
    const failed = await this.fetchBundles(allKeys);
    return { failed };
  }

  async loadOrder(key: string): Promise<void> {
    const cached = this.bundleOptions.deep ? null : await this.loadCachedOrder(key);
    if (cached) {
      this.bundles.push(new Bundle(key, cached, this.bundleOptions));
      return;
    }
    const r = await fetchWithRetry(
      `${BASE_URL}/api/v1/order/${key}?all_tpkds=true`,
      { headers: this.authHeaders },
      3,
      this.logger,
    );
    if (!r.ok) throw new Error(`Failed to fetch order ${key}: HTTP ${r.status}`);
    const data = (await r.json()) as BundleData;
    await this.saveCachedOrder(key, data).catch((e) => {
      this.logger(`Failed to cache order ${key}: ${e instanceof Error ? e.message : e}`);
    });
    this.bundles.push(new Bundle(key, data, this.bundleOptions));
  }

  async downloadLibrary(): Promise<{ downloaded: number; errors: number }> {
    const total = this.bundles.reduce((sum, b) => sum + b.totalFiles(), 0);
    let done = 0;
    let downloaded = 0;
    let errors = 0;

    const tasks = this.bundles.flatMap((b) => {
      const work = b.workItems();
      if (!this.bundleOptions.deep && hasFiles(b.dir)) {
        return work.map(() => async () => {
          done++;
          this.onProgress?.(done, total, downloaded);
        });
      }
      return work.map(({ item, subDir, productName, filename }) => async () => {
        try {
          const result = await b.doDownload(item, subDir, productName, filename);
          if (result === 'downloaded') downloaded++;
          else if (result === 'error') errors++;
        } catch (e) {
          this.logger(`Error: ${b.name} - ${productName}: ${e instanceof Error ? e.message : e}`);
          errors++;
        }
        done++;
        this.onProgress?.(done, total, downloaded);
      });
    });

    if (this.runTask) {
      await Promise.all(tasks.map((task) => this.runTask!(task)));
    } else {
      await runConcurrently(tasks, this.jobs);
    }
    return { downloaded, errors };
  }
}

function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((e) => !String(e).startsWith('.') && e !== 'old');
  } catch {
    return false;
  }
}
