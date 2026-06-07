import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { fetchWithRetryMock, bundleDownloadMock, bundleTotalFilesMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
  bundleDownloadMock: vi.fn<() => Promise<{ newFiles: number; errors: number }>>(() =>
    Promise.resolve({ newFiles: 1, errors: 0 }),
  ),
  bundleTotalFilesMock: vi.fn<() => number>(() => 1),
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
    override async download(onFile?: (result: 'downloaded' | 'skipped' | 'error') => void) {
      const result = await bundleDownloadMock();
      for (let i = 0; i < result.newFiles; i++) onFile?.('downloaded');
      for (let i = 0; i < result.errors; i++) onFile?.('error');
      return result;
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
    await lib.loadOrders();

    expect(lib.bundles).toHaveLength(1);
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
    await lib.loadOrders();

    expect(lib.bundles).toHaveLength(0);
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
});

// ---------------------------------------------------------------------------
// loadOrder (single key)
// ---------------------------------------------------------------------------

describe('Library.loadOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

// ---------------------------------------------------------------------------
// downloadLibrary
// ---------------------------------------------------------------------------

describe('Library.downloadLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleDownloadMock.mockResolvedValue({ newFiles: 1, errors: 0 });
    bundleTotalFilesMock.mockReturnValue(1);
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

  it('returns downloaded count equal to bundles that reported newFiles', async () => {
    bundleDownloadMock.mockResolvedValue({ newFiles: 3, errors: 0 });
    bundleTotalFilesMock.mockReturnValue(3);
    const lib = await loadedLibrary(2);
    const result = await lib.downloadLibrary();
    expect(result.downloaded).toBe(6);
    expect(result.errors).toBe(0);
  });

  it('accumulates errors from individual bundle downloads', async () => {
    bundleDownloadMock.mockResolvedValue({ newFiles: 0, errors: 2 });
    bundleTotalFilesMock.mockReturnValue(2);
    const lib = await loadedLibrary(3);
    const result = await lib.downloadLibrary();
    expect(result.errors).toBe(6);
  });

  it('counts a thrown error as one error and does not rethrow', async () => {
    bundleDownloadMock.mockRejectedValue(new Error('download crashed'));
    const lib = await loadedLibrary(1);
    const result = await lib.downloadLibrary();
    expect(result.errors).toBe(1);
    expect(result.downloaded).toBe(0);
  });

  it('calls onProgress after each file completes', async () => {
    bundleDownloadMock.mockResolvedValue({ newFiles: 1, errors: 0 });
    const onProgress = vi.fn();
    const lib = await loadedLibrary(3, { onProgress });
    await lib.downloadLibrary();
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('passes (done, total, downloaded) to onProgress', async () => {
    bundleDownloadMock.mockResolvedValue({ newFiles: 2, errors: 0 });
    bundleTotalFilesMock.mockReturnValue(2);
    const onProgress = vi.fn();
    const lib = await loadedLibrary(1, { onProgress, jobs: 1 });
    await lib.downloadLibrary();
    expect(onProgress).toHaveBeenCalledWith(2, 2, 2);
  });

  it('does not throw when onProgress is undefined', async () => {
    bundleDownloadMock.mockResolvedValue({ newFiles: 1, errors: 0 });
    const lib = await loadedLibrary(1);
    await expect(lib.downloadLibrary()).resolves.toBeDefined();
  });

  it('returns { downloaded: 0, errors: 0 } with no bundles', async () => {
    const lib = new Library(makeOptions());
    const result = await lib.downloadLibrary();
    expect(result).toEqual({ downloaded: 0, errors: 0 });
  });

  it('logs error messages when a bundle throws', async () => {
    bundleDownloadMock.mockRejectedValue(new Error('crash'));
    const logger = vi.fn();
    const lib = await loadedLibrary(1, { logger });
    await lib.downloadLibrary();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/error/i));
  });

  it('mixes downloaded and error counts across multiple bundles', async () => {
    bundleDownloadMock
      .mockResolvedValueOnce({ newFiles: 5, errors: 1 })
      .mockResolvedValueOnce({ newFiles: 3, errors: 0 })
      .mockRejectedValueOnce(new Error('crash'));

    const lib = await loadedLibrary(3, { jobs: 1 });
    const result = await lib.downloadLibrary();
    expect(result.downloaded).toBe(8);
    expect(result.errors).toBe(2);
  });
});
