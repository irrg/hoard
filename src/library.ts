import { API_BASE, exchangeKey } from './auth.js';
import { Product, ProductData, ProductOptions } from './product.js';
import { fetchWithRetry, runConcurrently } from './utils.js';

export interface LibraryOptions {
  apiKey: string;
  outputDir: string;
  jobs: number;
  compat: boolean;
  omitPublisher: boolean;
  dryRun: boolean;
  filters: string[];
  logger?: (msg: string) => void;
  onProgress?: (done: number, total: number, downloaded: number) => void;
}

export class Library {
  private apiKey: string;
  private bearerToken = '';
  products: Product[];
  private jobs: number;
  private filters: string[];
  private productOptions: ProductOptions;
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;

  constructor(options: LibraryOptions) {
    this.apiKey = options.apiKey;
    this.products = [];
    this.jobs = options.jobs;
    this.filters = options.filters.map((f) => f.toLowerCase());
    this.logger = options.logger ?? (() => {});
    this.onProgress = options.onProgress;
    this.productOptions = {
      outputDir: options.outputDir,
      compat: options.compat,
      omitPublisher: options.omitPublisher,
      dryRun: options.dryRun,
      logger: this.logger,
    };
  }

  async authenticate(): Promise<void> {
    this.logger('Authenticating...');
    this.bearerToken = await exchangeKey(this.apiKey);
  }

  async loadProducts(): Promise<void> {
    this.logger('Fetching product list...');
    let page = 1;
    while (true) {
      const r = await fetchWithRetry(
        `${API_BASE}order_products?getChecksum=1&getFilters=0&page=${page}&pageSize=50&library=1&archived=0`,
        { headers: { Authorization: this.bearerToken, Accept: 'application/json' } },
        3,
        this.logger,
      );

      if (!r.ok) {
        throw new Error(`Failed to load products: HTTP ${r.status}`);
      }

      let j: ProductData[];
      try {
        j = (await r.json()) as ProductData[];
      } catch {
        throw new Error(`Failed to parse product list page ${page} (HTTP ${r.status})`);
      }

      if (!Array.isArray(j) || j.length === 0) break;

      for (const data of j) {
        this.products.push(new Product(data, this.productOptions));
      }

      page++;
    }

    this.logger(`Found ${this.products.length} products`);
  }

  async downloadLibrary(): Promise<{ downloaded: number; errors: number }> {
    let done = 0;
    let downloaded = 0;
    let errors = 0;

    const products = this.filters.length
      ? this.products.filter((p) => this.filters.some((f) => p.name.toLowerCase().includes(f)))
      : this.products;
    const total = products.length;
    const tasks = products.map((p) => async () => {
      try {
        const wrote = await p.download(this.bearerToken);
        done++;
        if (wrote) downloaded++;
        this.logger(`Downloaded ${p.name} (${done} of ${total})`);
      } catch (e) {
        errors++;
        this.logger(`Error downloading ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
      this.onProgress?.(done + errors, total, downloaded);
    });

    await runConcurrently(tasks, this.jobs);
    return { downloaded, errors };
  }
}
