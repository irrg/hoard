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
}

export class Library {
  private apiKey: string;
  private bearerToken = '';
  products: Product[];
  private jobs: number;
  private filters: string[];
  private productOptions: ProductOptions;

  constructor(options: LibraryOptions) {
    this.apiKey = options.apiKey;
    this.products = [];
    this.jobs = options.jobs;
    this.filters = options.filters.map((f) => f.toLowerCase());
    this.productOptions = {
      outputDir: options.outputDir,
      compat: options.compat,
      omitPublisher: options.omitPublisher,
      dryRun: options.dryRun,
    };
  }

  async authenticate(): Promise<void> {
    console.log('Authenticating...');
    this.bearerToken = await exchangeKey(this.apiKey);
  }

  async loadProducts(): Promise<void> {
    console.log('Fetching product list...');
    let page = 1;
    while (true) {
      const r = await fetchWithRetry(
        `${API_BASE}order_products?getChecksum=1&getFilters=0&page=${page}&pageSize=50&library=1&archived=0`,
        { headers: { Authorization: this.bearerToken, Accept: 'application/json' } },
      );

      let j: ProductData[];
      try {
        j = (await r.json()) as ProductData[];
      } catch {
        console.log(`Failed to parse page ${page} (HTTP ${r.status}), stopping`);
        break;
      }

      if (!Array.isArray(j) || j.length === 0) break;

      for (const data of j) {
        this.products.push(new Product(data, this.productOptions));
      }

      page++;
    }

    console.log(`Found ${this.products.length} products`);
  }

  async downloadLibrary(): Promise<void> {
    let done = 0;
    let errors = 0;

    const products = this.filters.length
      ? this.products.filter((p) => this.filters.some((f) => p.name.toLowerCase().includes(f)))
      : this.products;
    const total = products.length;
    const tasks = products.map((p) => async () => {
      try {
        await p.download(this.bearerToken);
        done++;
        console.log(`Downloaded ${p.name} (${done} of ${total})`);
      } catch (e) {
        errors++;
        console.log(`Error downloading ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
    });

    await runConcurrently(tasks, this.jobs);
    console.log(`Downloaded ${done} products, ${errors} errors`);
  }
}
