import { Bundle, BundleData, BundleOptions } from "./bundle.js";
import { fetchWithRetry, runConcurrently } from "./utils.js";

const BASE_URL = "https://www.humblebundle.com";

export interface LibraryOptions {
  cookie: string;
  outputDir: string;
  jobs: number;
  platform?: string;
  extInclude: string[];
  extExclude: string[];
  dryRun: boolean;
  filters: string[];
}

export class Library {
  private cookie: string;
  private jobs: number;
  private bundleOptions: BundleOptions;
  bundles: Bundle[];

  constructor(options: LibraryOptions) {
    this.cookie = options.cookie;
    this.jobs = options.jobs;
    this.bundles = [];
    this.bundleOptions = {
      cookie: options.cookie,
      outputDir: options.outputDir,
      platform: options.platform,
      extInclude: options.extInclude,
      extExclude: options.extExclude,
      dryRun: options.dryRun,
      filters: options.filters,
    };
  }

  private get authHeaders(): Record<string, string> {
    return {
      Cookie: `_simpleauth_sess=${this.cookie}`,
      Accept: "application/json",
    };
  }

  private async fetchKeys(): Promise<string[]> {
    const r = await fetchWithRetry(`${BASE_URL}/api/v1/user/order`, {
      headers: this.authHeaders,
    });
    if (!r.ok) throw new Error(`Failed to fetch orders: HTTP ${r.status}`);
    const data = (await r.json()) as { gamekey: string }[];
    return Array.isArray(data) ? data.map((d) => d.gamekey) : [];
  }

  private async fetchBundles(keys: string[]): Promise<void> {
    for (const key of keys) {
      const r = await fetchWithRetry(`${BASE_URL}/api/v1/order/${key}?all_tpkds=true`, {
        headers: this.authHeaders,
      });
      if (!r.ok) {
        console.log(`Failed to fetch order ${key}: HTTP ${r.status}`);
        continue;
      }
      let data: BundleData;
      try {
        data = (await r.json()) as BundleData;
      } catch {
        console.log(`Failed to parse order ${key}`);
        continue;
      }
      this.bundles.push(new Bundle(key, data, this.bundleOptions));
    }
  }

  async loadOrders(keys?: string[]): Promise<void> {
    const allKeys = keys ?? (await this.fetchKeys());
    console.log(`Found ${allKeys.length} orders`);
    await this.fetchBundles(allKeys);
  }

  async loadOrder(key: string): Promise<void> {
    const r = await fetchWithRetry(`${BASE_URL}/api/v1/order/${key}?all_tpkds=true`, {
      headers: this.authHeaders,
    });
    if (!r.ok) throw new Error(`Failed to fetch order ${key}: HTTP ${r.status}`);
    const data = (await r.json()) as BundleData;
    this.bundles.push(new Bundle(key, data, this.bundleOptions));
  }

  async downloadLibrary(): Promise<void> {
    const total = this.bundles.length;
    let done = 0;
    let errors = 0;

    const tasks = this.bundles.map((b) => async () => {
      try {
        await b.download();
        done++;
        console.log(`Downloaded ${b.name} (${done} of ${total})`);
      } catch (e) {
        errors++;
        console.log(`Error downloading ${b.name}: ${e instanceof Error ? e.message : e}`);
      }
    });

    await runConcurrently(tasks, this.jobs);
    console.log(`Downloaded ${done} bundles, ${errors} errors`);
  }
}
