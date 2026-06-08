import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist fs mocks so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { existsSyncMock, readFileMock, writeFileMock, mkdirMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<() => boolean>(() => false),
  readFileMock: vi.fn<() => Promise<string>>(),
  writeFileMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mkdirMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('fs', () => ({ existsSync: existsSyncMock }));
vi.mock('fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));

import { Library } from '../src/library.js';
import type { ProductData } from '../src/product.js';

function mockResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => body,
  } as unknown as Response;
}

function productFixture(id: number, modified = '2024-01-01T00:00:00Z'): ProductData {
  return {
    productId: `prod-${id}`,
    orderProductId: id,
    name: `Product ${id}`,
    publisher: { name: 'Test Publisher' },
    fileLastModified: modified,
    files: [{ index: 0, filename: `file${id}.pdf`, checksums: null }],
  };
}

function makeLibrary(overrides: Partial<ConstructorParameters<typeof Library>[0]> = {}) {
  return new Library({
    apiKey: 'test-api-key',
    outputDir: '/tmp/output',
    jobs: 1,
    compat: false,
    omitPublisher: false,
    dryRun: false,
    filters: [],
    logger: () => {},
    ...overrides,
  });
}

describe('Library', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    existsSyncMock.mockReturnValue(false);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('authenticate', () => {
    it('sets the bearer token via exchangeKey', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ token: 'bearer-xyz', refreshToken: 'r', refreshTokenTTL: 0 }),
      );
      const lib = makeLibrary();
      await lib.authenticate();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('auth_key'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('propagates errors from exchangeKey', async () => {
      fetchMock.mockResolvedValue({ status: 401, ok: false, json: async () => ({}) });
      await expect(makeLibrary().authenticate()).rejects.toThrow('Invalid API key');
    });
  });

  describe('loadProducts (full fetch — no cache)', () => {
    it('loads a single page of products', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse([productFixture(1), productFixture(2)]))
        .mockResolvedValueOnce(mockResponse([]));
      const lib = makeLibrary();
      await lib.loadProducts();
      expect(lib.products).toHaveLength(2);
    });

    it('paginates across multiple pages until an empty array', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse([productFixture(1), productFixture(2)]))
        .mockResolvedValueOnce(mockResponse([productFixture(3)]))
        .mockResolvedValueOnce(mockResponse([]));
      const lib = makeLibrary();
      await lib.loadProducts();
      expect(lib.products).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('stops when the response is not an array', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ message: 'not an array' }));
      const lib = makeLibrary();
      await lib.loadProducts();
      expect(lib.products).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops when the first page is an empty array', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      const lib = makeLibrary();
      await lib.loadProducts();
      expect(lib.products).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws on non-ok HTTP response', async () => {
      fetchMock.mockResolvedValue({ status: 403, ok: false, json: async () => ({}) });
      await expect(makeLibrary().loadProducts()).rejects.toThrow(
        'Failed to load products: HTTP 403',
      );
    });

    it('throws when JSON parsing fails', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      });
      await expect(makeLibrary().loadProducts()).rejects.toThrow(
        'Failed to parse product list page 1',
      );
    });

    it('includes page parameter in request URL', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse([productFixture(1)]))
        .mockResolvedValueOnce(mockResponse([]));
      await makeLibrary().loadProducts();
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('page=1'),
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('page=2'),
        expect.any(Object),
      );
    });

    it('sends the Authorization header', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({ token: 'my-bearer', refreshToken: 'r', refreshTokenTTL: 0 }),
        )
        .mockResolvedValueOnce(mockResponse([]));
      const lib = makeLibrary();
      await lib.authenticate();
      await lib.loadProducts();
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('order_products'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'my-bearer' }),
        }),
      );
    });

    it('writes each page to the cache dir', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse([productFixture(1)]))
        .mockResolvedValueOnce(mockResponse([]));
      await makeLibrary().loadProducts();
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('1.json'),
        expect.any(String),
      );
    });

    it('writes meta.json with sort order after full fetch', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse([
            productFixture(1, '2024-06-01T00:00:00Z'),
            productFixture(2, '2024-05-01T00:00:00Z'),
          ]),
        )
        .mockResolvedValueOnce(mockResponse([productFixture(3, '2024-01-01T00:00:00Z')]))
        .mockResolvedValueOnce(mockResponse([]));
      await makeLibrary().loadProducts();
      const metaCall = writeFileMock.mock.calls.find(([p]) => (p as string).endsWith('meta.json'));
      expect(metaCall).toBeDefined();
      const meta = JSON.parse(metaCall![1] as string);
      expect(meta.sortOrder).toBe('newest-first');
      expect(meta.totalPages).toBe(2);
    });
  });

  describe('loadProducts (cache hit)', () => {
    function setupCacheHit(opts: {
      meta: { totalPages: number; sortOrder: string };
      pages: ProductData[][];
      sentinelPage: number;
    }) {
      existsSyncMock.mockReturnValue(true);

      const metaStr = JSON.stringify(opts.meta);
      const pageStrs = opts.pages.map((p) => JSON.stringify(p));
      const sentinelStr = pageStrs[opts.sentinelPage - 1];

      // readFile call order:
      //   1. meta.json
      //   2. sentinel cache file (for comparison)
      //   3..N: all page files for loading
      readFileMock.mockResolvedValueOnce(metaStr).mockResolvedValueOnce(sentinelStr);
      for (const s of pageStrs) {
        readFileMock.mockResolvedValueOnce(s);
      }

      // fetch returns the same data as the cached sentinel → cache valid
      fetchMock.mockResolvedValueOnce(mockResponse(opts.pages[opts.sentinelPage - 1]));
    }

    it('loads all products from cache without additional fetches when newest-first sentinel matches', async () => {
      const pages = [[productFixture(1), productFixture(2)], [productFixture(3)]];
      setupCacheHit({ meta: { totalPages: 2, sortOrder: 'newest-first' }, pages, sentinelPage: 1 });

      const lib = makeLibrary();
      await lib.loadProducts();

      expect(lib.products).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(1); // only sentinel
    });

    it('loads all products from cache for oldest-first using last page as sentinel', async () => {
      const pages = [[productFixture(1)], [productFixture(2), productFixture(3)]];
      setupCacheHit({ meta: { totalPages: 2, sortOrder: 'oldest-first' }, pages, sentinelPage: 2 });

      const lib = makeLibrary();
      await lib.loadProducts();

      expect(lib.products).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to full fetch when sentinel page differs from cache', async () => {
      existsSyncMock.mockReturnValue(true);

      const cachedPage1 = [productFixture(1)];
      const freshPage1 = [productFixture(99), productFixture(1)]; // new item

      readFileMock
        .mockResolvedValueOnce(JSON.stringify({ totalPages: 1, sortOrder: 'newest-first' }))
        .mockResolvedValueOnce(JSON.stringify(cachedPage1)); // sentinel cache

      fetchMock
        .mockResolvedValueOnce(mockResponse(freshPage1)) // sentinel differs → cache miss
        .mockResolvedValueOnce(mockResponse(freshPage1)) // full fetch page 1
        .mockResolvedValueOnce(mockResponse([])); // full fetch page 2 empty → stop

      const lib = makeLibrary();
      await lib.loadProducts();

      expect(lib.products).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('falls back to full fetch when cache read throws', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockRejectedValueOnce(new Error('disk error'));

      fetchMock
        .mockResolvedValueOnce(mockResponse([productFixture(1)]))
        .mockResolvedValueOnce(mockResponse([]));

      const lib = makeLibrary();
      await lib.loadProducts();

      expect(lib.products).toHaveLength(1);
    });
  });

  describe('downloadLibrary', () => {
    function fakeProduct(name: string, wrote: boolean | 'throw' = true) {
      return {
        name,
        download:
          wrote === 'throw'
            ? vi.fn().mockRejectedValue(new Error(`Download failed for ${name}`))
            : vi.fn().mockResolvedValue(wrote),
      } as unknown as import('../src/product.js').Product;
    }

    it('returns downloaded count matching products that wrote files', async () => {
      const lib = makeLibrary();
      lib.products = [fakeProduct('A', true), fakeProduct('B', true)];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('counts products where download returns false as not-downloaded', async () => {
      const lib = makeLibrary();
      lib.products = [fakeProduct('A', true), fakeProduct('B', false)];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('counts errors per product without throwing', async () => {
      const lib = makeLibrary();
      lib.products = [fakeProduct('A', true), fakeProduct('B', 'throw')];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(1);
      expect(result.errors).toBe(1);
    });

    it('returns zero downloaded and zero errors for an empty library', async () => {
      const lib = makeLibrary();
      lib.products = [];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('filters products by name when filters are set', async () => {
      const lib = makeLibrary({ filters: ['pathfinder'] });
      const p1 = fakeProduct('Pathfinder Core Rules', true);
      const p2 = fakeProduct('D&D Player Handbook', true);
      lib.products = [p1, p2];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(1);
      expect(p1.download as ReturnType<typeof vi.fn>).toHaveBeenCalled();
      expect(p2.download as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('filter matching is case-insensitive', async () => {
      const lib = makeLibrary({ filters: ['PATHFINDER'] });
      const p1 = fakeProduct('Pathfinder Core Rules', true);
      lib.products = [p1];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(1);
    });

    it('supports multiple filter terms (OR logic)', async () => {
      const lib = makeLibrary({ filters: ['pathfinder', 'starfinder'] });
      const p1 = fakeProduct('Pathfinder Beginner Box', true);
      const p2 = fakeProduct('Starfinder Core', true);
      const p3 = fakeProduct('Call of Cthulhu', true);
      lib.products = [p1, p2, p3];
      const result = await lib.downloadLibrary();
      expect(result.downloaded).toBe(2);
    });

    it('calls onProgress after each product completes', async () => {
      const onProgress = vi.fn();
      const lib = makeLibrary({ onProgress });
      lib.products = [fakeProduct('A', true), fakeProduct('B', false)];
      await lib.downloadLibrary();
      expect(onProgress).toHaveBeenCalledTimes(2);
      const lastCall = onProgress.mock.calls.at(-1) as [number, number, number];
      expect(lastCall[1]).toBe(2); // total
      expect(lastCall[2]).toBe(1); // downloaded
    });
  });
});
