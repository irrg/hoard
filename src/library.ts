import { Bundle, BundleData, BundleOptions } from './bundle.js';
import { fetchWithRetry, runConcurrently } from './utils.js';

const BASE_URL = 'https://www.humblebundle.com';

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
}

export class Library {
  private cookie: string;
  private jobs: number;
  private bundleOptions: BundleOptions;
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;
  bundles: Bundle[];

  constructor(options: LibraryOptions) {
    this.cookie = options.cookie;
    this.jobs = options.jobs;
    this.bundles = [];
    this.logger = options.logger ?? (() => {});
    this.onProgress = options.onProgress;
    this.bundleOptions = {
      cookie: options.cookie,
      outputDir: options.outputDir,
      platform: options.platform,
      extInclude: options.extInclude,
      extExclude: options.extExclude,
      dryRun: options.dryRun,
      filters: options.filters,
      logger: this.logger,
    };
  }

  private get authHeaders(): Record<string, string> {
    return {
      Cookie: `_simpleauth_sess=${this.cookie}`,
      Accept: 'application/json',
    };
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

  private async fetchBundles(keys: string[]): Promise<void> {
    const results = await Promise.all(
      keys.map(async (key) => {
        const r = await fetchWithRetry(
          `${BASE_URL}/api/v1/order/${key}?all_tpkds=true`,
          { headers: this.authHeaders },
          3,
          this.logger,
        );
        if (!r.ok) {
          this.logger(`Failed to fetch order ${key}: HTTP ${r.status}`);
          return null;
        }
        try {
          const data = (await r.json()) as BundleData;
          return new Bundle(key, data, this.bundleOptions);
        } catch {
          this.logger(`Failed to parse order ${key}`);
          return null;
        }
      }),
    );
    for (const bundle of results) {
      if (bundle) this.bundles.push(bundle);
    }
  }

  async loadOrders(keys?: string[]): Promise<void> {
    const allKeys = keys ?? (await this.fetchKeys());
    this.logger(`Found ${allKeys.length} orders`);
    await this.fetchBundles(allKeys);
  }

  async loadOrder(key: string): Promise<void> {
    const r = await fetchWithRetry(
      `${BASE_URL}/api/v1/order/${key}?all_tpkds=true`,
      { headers: this.authHeaders },
      3,
      this.logger,
    );
    if (!r.ok) throw new Error(`Failed to fetch order ${key}: HTTP ${r.status}`);
    const data = (await r.json()) as BundleData;
    this.bundles.push(new Bundle(key, data, this.bundleOptions));
  }

  async downloadLibrary(): Promise<{ downloaded: number; errors: number }> {
    const total = this.bundles.reduce((sum, b) => sum + b.totalFiles(), 0);
    let done = 0;
    let downloaded = 0;
    let errors = 0;

    const tasks = this.bundles.map((b) => async () => {
      try {
        await b.download((result) => {
          done++;
          if (result === 'downloaded') downloaded++;
          else if (result === 'error') errors++;
          this.onProgress?.(done, total, downloaded);
        });
      } catch (e) {
        this.logger(`Error downloading ${b.name}: ${e instanceof Error ? e.message : e}`);
        errors++;
      }
    });

    await runConcurrently(tasks, this.jobs);
    return { downloaded, errors };
  }
}
