import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const fakeItem = { url: { web: 'http://x/file.pdf' } };
const fakeWorkItem = { item: fakeItem, subDir: '/tmp', productName: 'p', filename: 'file.pdf' };

const { fetchWithRetryMock, bundleDoDownloadMock, bundleWorkItemsMock, bundleTotalFilesMock } =
  vi.hoisted(() => ({
    fetchWithRetryMock: vi.fn(),
    bundleDoDownloadMock: vi.fn<
      (...args: unknown[]) => Promise<'downloaded' | 'skipped' | 'error'>
    >(() => Promise.resolve('downloaded')),
    bundleWorkItemsMock: vi.fn(() => [fakeWorkItem]),
    bundleTotalFilesMock: vi.fn<() => number>(() => 1),
  }));

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils.js')>();
  return {
    ...original,
    fetchWithRetry: fetchWithRetryMock,
  };
});

vi.mock('../src/bundle.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/bundle.js')>();
  class MockBundle extends original.Bundle {
    override totalFiles() {
      return bundleTotalFilesMock();
    }
    override workItems() {
      return bundleWorkItemsMock() as ReturnType<typeof super.workItems>;
    }
    override async doDownload(
      ...args: Parameters<InstanceType<typeof original.Bundle>['doDownload']>
    ) {
      return bundleDoDownloadMock(...args);
    }
  }
  return { ...original, Bundle: MockBundle };
});

import { Library, LibraryOptions } from '../src/library.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => body };
}

function makeOptions(overrides: Partial<LibraryOptions> = {}): LibraryOptions {
  return {
    cookie: 'test-session-cookie',
    outputDir: '/tmp/hoard',
    jobs: 2,
    extInclude: [],
    extExclude: [],
    dryRun: false,
    filters: [],
    logger: vi.fn(),
    ...overrides,
  };
}

function makeBundleData(name = 'Test Bundle') {
  return {
    product: { human_name: name },
    subproducts: [],
  };
}

function makeCacheEntry(data: ReturnType<typeof makeBundleData>, ageMs = 0) {
  return JSON.stringify({
    fetchedAt: new Date(Date.now() - ageMs).toISOString(),
    data,
  });
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('Library constructor', () => {
  it('initialises bundles to an empty array', () => {
    const lib = new Library(makeOptions());
    expect(lib.bundles).toEqual([]);
  });

  it('uses a no-op logger by default without throwing', () => {
    const lib = new Library(makeOptions({ logger: undefined }));
    expect(lib.bundles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadOrders
// ---------------------------------------------------------------------------

describe('Library.loadOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default: cache miss
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches keys from /api/v1/user/order when none provided', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }, { gamekey: 'key-b' }]))
      .mockResolvedValueOnce(mockResponse(makeBundleData('Bundle A')))
      .mockResolvedValueOnce(mockResponse(makeBundleData('Bundle B')));

    const lib = new Library(makeOptions());
    await lib.loadOrders();

    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/user/order'),
      expect.objectContaining({ headers: expect.any(Object) }),
      expect.any(Number),
      expect.any(Function),
    );
    expect(lib.bundles).toHaveLength(2);
  });

  it('uses provided keys instead of fetching them', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse(makeBundleData()));

    const lib = new Library(makeOptions());
    await lib.loadOrders(['provided-key']);

    for (const call of fetchWithRetryMock.mock.calls) {
      expect(call[0]).not.toContain('/api/v1/user/order');
    }
    expect(lib.bundles).toHaveLength(1);
  });

  it('sends the session cookie in the Cookie header', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'k' }]))
      .mockResolvedValueOnce(mockResponse(makeBundleData()));

    const lib = new Library(makeOptions({ cookie: 'my-secret-cookie' }));
    await lib.loadOrders();

    const firstCall = fetchWithRetryMock.mock.calls[0];
    const headers = firstCall[1]?.headers as Record<string, string>;
    expect(headers['Cookie']).toContain('my-secret-cookie');
  });

  it('throws when the user/order endpoint returns HTTP 401', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse({}, 401));
    const lib = new Library(makeOptions());
    await expect(lib.loadOrders()).rejects.toThrow(/401/);
  });

  it('skips a bundle when the order endpoint returns HTTP 500', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }, { gamekey: 'key-b' }]))
      .mockResolvedValueOnce(mockResponse({}, 500))
      .mockResolvedValueOnce(mockResponse(makeBundleData('Bundle B')));

    const logger = vi.fn();
    const lib = new Library(makeOptions({ logger }));
    const { failed } = await lib.loadOrders();

    expect(lib.bundles).toHaveLength(1);
    expect(failed).toBe(1);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/Failed to fetch order key-a/i));
  });

  it('skips a bundle when the order response body is invalid JSON', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }]))
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });

    const logger = vi.fn();
    const lib = new Library(makeOptions({ logger }));
    const { failed } = await lib.loadOrders();

    expect(lib.bundles).toHaveLength(0);
    expect(failed).toBe(1);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/failed to parse order key-a/i));
  });

  it('logs the number of orders found', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'k1' }, { gamekey: 'k2' }]))
      .mockResolvedValue(mockResponse(makeBundleData()));

    const logger = vi.fn();
    const lib = new Library(makeOptions({ logger }));
    await lib.loadOrders();

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('2'));
  });

  it('handles an empty order list gracefully', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse([]));
    const lib = new Library(makeOptions());
    await lib.loadOrders();
    expect(lib.bundles).toHaveLength(0);
  });

  it('handles a non-array response from user/order', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse({ error: 'not an array' }));
    const lib = new Library(makeOptions());
    await lib.loadOrders();
    expect(lib.bundles).toHaveLength(0);
  });

  it('serves order from cache and skips fetch when cache is fresh', async () => {
    fetchWithRetryMock.mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }]));
    mockReadFile.mockResolvedValue(makeCacheEntry(makeBundleData('Cached Bundle')));

    const lib = new Library(makeOptions());
    await lib.loadOrders();

    // only the keys fetch should have been called, not the order detail fetch
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    expect(fetchWithRetryMock.mock.calls[0][0]).toContain('/api/v1/user/order');
    expect(lib.bundles).toHaveLength(1);
    expect(lib.bundles[0].name).toBe('Cached Bundle');
  });

  it('re-fetches order when cache is older than TTL', async () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }]))
      .mockResolvedValueOnce(mockResponse(makeBundleData('Fresh Bundle')));
    mockReadFile.mockResolvedValue(makeCacheEntry(makeBundleData('Stale Bundle'), eightDaysMs));

    const lib = new Library(makeOptions());
    await lib.loadOrders();

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    expect(lib.bundles[0].name).toBe('Fresh Bundle');
  });

  it('re-fetches order in deep mode even when cache is fresh', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }]))
      .mockResolvedValueOnce(mockResponse(makeBundleData('Fresh Bundle')));
    mockReadFile.mockResolvedValue(makeCacheEntry(makeBundleData('Cached Bundle')));

    const lib = new Library(makeOptions({ deep: true }));
    await lib.loadOrders();

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    expect(lib.bundles[0].name).toBe('Fresh Bundle');
  });

  it('writes fetched order data to cache', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(mockResponse([{ gamekey: 'key-a' }]))
      .mockResolvedValueOnce(mockResponse(makeBundleData('New Bundle')));

    const lib = new Library(makeOptions());
    await lib.loadOrders();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('key-a.json'),
      expect.stringContaining('New Bundle'),
      'utf-8',
    );
  });
});

// ---------------------------------------------------------------------------
// loadOrder (single key)
// ---------------------------------------------------------------------------

describe('Library.loadOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('fetches from /api/v1/order/:key', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse(makeBundleData('Single Bundle')));
    const lib = new Library(makeOptions());
    await lib.loadOrder('my-key');

    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/order/my-key'),
      expect.any(Object),
      expect.any(Number),
      expect.any(Function),
    );
    expect(lib.bundles).toHaveLength(1);
    expect(lib.bundles[0].name).toBe('Single Bundle');
  });

  it('includes all_tpkds=true in the URL', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse(makeBundleData()));
    const lib = new Library(makeOptions());
    await lib.loadOrder('my-key');

    const url: string = fetchWithRetryMock.mock.calls[0][0];
    expect(url).toContain('all_tpkds=true');
  });

  it('throws when the order endpoint returns HTTP 404', async () => {
    fetchWithRetryMock.mockResolvedValue(mockResponse({}, 404));
    const lib = new Library(makeOptions());
    await expect(lib.loadOrder('bad-key')).rejects.toThrow(/404/);
  });

  it('serves from cache without fetching when cache is fresh', async () => {
    mockReadFile.mockResolvedValue(makeCacheEntry(makeBundleData('Cached Order')));
    const lib = new Library(makeOptions());
    await lib.loadOrder('my-key');

    expect(fetchWithRetryMock).not.toHaveBeenCalled();
    expect(lib.bundles[0].name).toBe('Cached Order');
  });
});

// ---------------------------------------------------------------------------
// downloadLibrary
// ---------------------------------------------------------------------------

describe('Library.downloadLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleDoDownloadMock.mockResolvedValue('downloaded');
    bundleWorkItemsMock.mockReturnValue([fakeWorkItem]);
    bundleTotalFilesMock.mockReturnValue(1);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function loadedLibrary(
    bundleCount: number,
    options: Partial<LibraryOptions> = {},
  ): Promise<Library> {
    fetchWithRetryMock
      .mockResolvedValueOnce(
        mockResponse(Array.from({ length: bundleCount }, (_, i) => ({ gamekey: `key-${i}` }))),
      )
      .mockResolvedValue(mockResponse(makeBundleData()));

    const lib = new Library(makeOptions({ jobs: 2, ...options }));
    await lib.loadOrders();
    return lib;
  }

  it('returns downloaded count equal to total files downloaded', async () => {
    bundleWorkItemsMock.mockReturnValue([fakeWorkItem, fakeWorkItem, fakeWorkItem]);
    bundleTotalFilesMock.mockReturnValue(3);
    bundleDoDownloadMock.mockResolvedValue('downloaded');
    const lib = await loadedLibrary(2);
    const result = await lib.downloadLibrary();
    expect(result.downloaded).toBe(6);
    expect(result.errors).toBe(0);
  });

  it('accumulates errors from individual file downloads', async () => {
    bundleWorkItemsMock.mockReturnValue([fakeWorkItem, fakeWorkItem]);
    bundleTotalFilesMock.mockReturnValue(2);
    bundleDoDownloadMock.mockResolvedValue('error');
    const lib = await loadedLibrary(3);
    const result = await lib.downloadLibrary();
    expect(result.errors).toBe(6);
  });

  it('counts a thrown error as one error and does not rethrow', async () => {
    bundleDoDownloadMock.mockRejectedValue(new Error('download crashed'));
    const lib = await loadedLibrary(1);
    const result = await lib.downloadLibrary();
    expect(result.errors).toBe(1);
    expect(result.downloaded).toBe(0);
  });

  it('calls onProgress after each file completes', async () => {
    const onProgress = vi.fn();
    const lib = await loadedLibrary(3, { onProgress });
    await lib.downloadLibrary();
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('passes (done, total, downloaded) to onProgress', async () => {
    bundleWorkItemsMock.mockReturnValue([fakeWorkItem, fakeWorkItem]);
    bundleTotalFilesMock.mockReturnValue(2);
    const onProgress = vi.fn();
    const lib = await loadedLibrary(1, { onProgress, jobs: 1 });
    await lib.downloadLibrary();
    expect(onProgress).toHaveBeenCalledWith(2, 2, 2);
  });

  it('does not throw when onProgress is undefined', async () => {
    const lib = await loadedLibrary(1);
    await expect(lib.downloadLibrary()).resolves.toBeDefined();
  });

  it('returns { downloaded: 0, errors: 0 } with no bundles', async () => {
    const lib = new Library(makeOptions());
    const result = await lib.downloadLibrary();
    expect(result).toEqual({ downloaded: 0, errors: 0 });
  });

  it('logs error messages when a file download throws', async () => {
    bundleDoDownloadMock.mockRejectedValue(new Error('crash'));
    const logger = vi.fn();
    const lib = await loadedLibrary(1, { logger });
    await lib.downloadLibrary();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/error/i));
  });

  it('forwards the filename from workItem to doDownload', async () => {
    bundleWorkItemsMock.mockReturnValue([
      { item: fakeItem, subDir: '/tmp/a', productName: 'Book', filename: 'book_42.pdf' },
    ]);
    bundleTotalFilesMock.mockReturnValue(1);
    const lib = await loadedLibrary(1, { jobs: 1 });
    await lib.downloadLibrary();
    expect(bundleDoDownloadMock).toHaveBeenCalledWith(fakeItem, '/tmp/a', 'Book', 'book_42.pdf');
  });

  it('mixes downloaded and error counts across multiple bundles', async () => {
    bundleWorkItemsMock
      .mockReturnValueOnce(Array(6).fill(fakeWorkItem))
      .mockReturnValueOnce(Array(3).fill(fakeWorkItem))
      .mockReturnValueOnce([fakeWorkItem]);
    bundleTotalFilesMock.mockReturnValueOnce(6).mockReturnValueOnce(3).mockReturnValueOnce(1);
    bundleDoDownloadMock
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockResolvedValueOnce('downloaded')
      .mockRejectedValueOnce(new Error('crash'));

    const lib = await loadedLibrary(3, { jobs: 1 });
    const result = await lib.downloadLibrary();
    expect(result.downloaded).toBe(8);
    expect(result.errors).toBe(2);
  });
});
