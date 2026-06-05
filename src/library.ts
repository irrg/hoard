import { Bundle, BundleData, BundleOptions } from "./bundle.js";
import { fetchWithRetry, runConcurrently } from "./utils.js";

const BASE_URL = "https://www.humblebundle.com";
const CHUNK_SIZE = 10;

export interface LibraryOptions {
  cookie: string;
  outputDir: string;
  jobs: number;
  platform?: string;
  extInclude: string[];
  extExclude: string[];
  dryRun: boolean;
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
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      chunks.push(keys.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const params = new URLSearchParams({ all_tpkds: "true" });
      for (const k of chunk) params.append("gamekeys", k);

      const r = await fetchWithRetry(`${BASE_URL}/api/v1/orders?${params}`, {
        headers: this.authHeaders,
      });

      if (!r.ok) {
        console.log(`Failed to fetch bundle chunk: HTTP ${r.status}`);
        continue;
      }

      let data: Record<string, BundleData>;
      try {
        data = (await r.json()) as Record<string, BundleData>;
      } catch {
        console.log("Failed to parse bundle chunk response");
        continue;
      }

      for (const [key, bundleData] of Object.entries(data)) {
        this.bundles.push(new Bundle(key, bundleData, this.bundleOptions));
      }
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
        console.log(`Done ${b.title} (${done} of ${total})`);
      } catch (e) {
        errors++;
        console.log(`Error downloading ${b.title}: ${e instanceof Error ? e.message : e}`);
      }
    });

    await runConcurrently(tasks, this.jobs);
    console.log(`Downloaded ${done} bundles, ${errors} errors`);
  }
}
