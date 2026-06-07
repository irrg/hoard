import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

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

interface PageCacheMeta {
  totalPages: number;
  sortOrder: 'newest-first' | 'oldest-first' | 'unknown';
  lastFetched: string;
}

const PRODUCTS_URL = `${API_BASE}order_products?getChecksum=1&getFilters=0&pageSize=50&library=1&archived=0`;

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
    const pagesDir = join(this.productOptions.outputDir, '.data', 'pages');
    const metaPath = join(pagesDir, 'meta.json');

    if (existsSync(metaPath)) {
      try {
        const loaded = await this._loadFromCache(pagesDir, metaPath);
        if (loaded) return;
      } catch {
        this.products = [];
      }
    }

    await this._fetchAllPages(pagesDir, metaPath);
  }

  private async _fetchPage(page: number): Promise<ProductData[] | null> {
    const r = await fetchWithRetry(
      `${PRODUCTS_URL}&page=${page}`,
      { headers: { Authorization: this.bearerToken, Accept: 'application/json' } },
      3,
      this.logger,
    );
    if (!r.ok) throw new Error(`Failed to load products: HTTP ${r.status}`);
    let j: ProductData[];
    try {
      j = (await r.json()) as ProductData[];
    } catch {
      throw new Error(`Failed to parse product list page ${page} (HTTP ${r.status})`);
    }
    if (!Array.isArray(j) || j.length === 0) return null;
    return j;
  }

  private async _loadFromCache(pagesDir: string, metaPath: string): Promise<boolean> {
    const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as PageCacheMeta;

    const sentinelPages = [
      ...new Set(
        meta.sortOrder === 'oldest-first'
          ? [meta.totalPages]
          : meta.sortOrder === 'newest-first'
            ? [1]
            : [1, meta.totalPages],
      ),
    ];

    for (const sp of sentinelPages) {
      const fresh = await this._fetchPage(sp);
      const cached = JSON.parse(
        await readFile(join(pagesDir, `${sp}.json`), 'utf-8'),
      ) as ProductData[];
      if (JSON.stringify(fresh) !== JSON.stringify(cached)) return false;
    }

    this.logger('Product list unchanged, loading from cache');
    for (let i = 1; i <= meta.totalPages; i++) {
      const page = JSON.parse(
        await readFile(join(pagesDir, `${i}.json`), 'utf-8'),
      ) as ProductData[];
      for (const data of page) {
        this.products.push(new Product(data, this.productOptions));
      }
    }
    this.logger(`Found ${this.products.length} products (cached)`);
    return true;
  }

  private async _fetchAllPages(pagesDir: string, metaPath: string): Promise<void> {
    this.logger('Fetching product list...');
    await mkdir(pagesDir, { recursive: true });

    let page = 1;
    const allPages: ProductData[][] = [];

    while (true) {
      const j = await this._fetchPage(page);
      if (!j) break;

      await writeFile(join(pagesDir, `${page}.json`), JSON.stringify(j, null, 2));
      allPages.push(j);
      for (const data of j) {
        this.products.push(new Product(data, this.productOptions));
      }
      page++;
    }

    if (allPages.length >= 1) {
      let sortOrder: PageCacheMeta['sortOrder'] = 'unknown';
      if (allPages.length > 1) {
        const firstTime = new Date(allPages[0][0].fileLastModified).getTime();
        const lastPage = allPages[allPages.length - 1];
        const lastTime = new Date(lastPage[lastPage.length - 1].fileLastModified).getTime();
        sortOrder =
          firstTime > lastTime ? 'newest-first' : firstTime < lastTime ? 'oldest-first' : 'unknown';
      }
      try {
        await writeFile(
          metaPath,
          JSON.stringify(
            { totalPages: page - 1, sortOrder, lastFetched: new Date().toISOString() },
            null,
            2,
          ),
        );
      } catch {}
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
