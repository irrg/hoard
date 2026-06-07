import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Library, type LibraryOptions } from '../src/library.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils.js')>();
  return {
    ...original,
    md5sum: vi.fn(),
    streamToFile: vi.fn().mockResolvedValue(undefined),
    runConcurrently: vi.fn(async (tasks: Array<() => Promise<void>>, _limit: number) => {
      for (const t of tasks) await t();
    }),
  };
});

vi.mock('../src/bundle.js', () => ({
  fetchBundlePage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from 'fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises';

import { fetchBundlePage } from '../src/bundle.js';
import { md5sum, streamToFile } from '../src/utils.js';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockAppendFile = vi.mocked(appendFile);
const mockMkdir = vi.mocked(mkdir);
const mockReadFile = vi.mocked(readFile);
const mockRename = vi.mocked(rename);
const mockWriteFile = vi.mocked(writeFile);
const mockMd5sum = vi.mocked(md5sum);
const mockStreamToFile = vi.mocked(streamToFile);
const mockFetchBundlePage = vi.mocked(fetchBundlePage);

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeLibrary(overrides: Partial<LibraryOptions> = {}): Library {
  return new Library({
    outputDir: '/output',
    jobs: 1,
    dryRun: false,
    cookie: 'session=test',
    filters: [],
    logger: vi.fn(),
    ...overrides,
  });
}

function makeBundle(key = 'bundle-key', title = 'Test Bundle', files = [makeFile()]) {
  return { key, title, files };
}

function makeFile(
  opts: {
    filename?: string;
    url?: string;
    md5?: string;
  } = {},
) {
  return {
    filename: opts.filename ?? 'book.pdf',
    url: opts.url ?? 'https://bundleofholding.com/dl/x/book.pdf',
    md5: opts.md5 ?? 'abc123',
  };
}

function makeBundleRef(key = 'bundle-key', name = 'Test Bundle') {
  return { key, name };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no files exist on disk
  mockExistsSync.mockReturnValue(false);
  // Default: directory is empty (shallow check sees no files)
  mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
  // Default: fetchBundlePage returns a single-file bundle
  mockFetchBundlePage.mockResolvedValue(makeBundle());
  // Default: md5sum returns the expected hash
  mockMd5sum.mockResolvedValue('abc123');
  // Default: readFile returns the md5 sidecar content
  mockReadFile.mockResolvedValue('abc123' as unknown as Buffer);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// downloadBundles — happy path
// ---------------------------------------------------------------------------

describe('Library.downloadBundles', () => {
  it('downloads a single bundle and reports downloaded=1', async () => {
    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(result).toEqual({ downloaded: 1, errors: 0 });
    expect(mockStreamToFile).toHaveBeenCalledOnce();
  });

  it('increments downloaded once per bundle, not per file', async () => {
    mockFetchBundlePage.mockResolvedValue(
      makeBundle('k', 'Bundle', [makeFile({ filename: 'a.pdf' }), makeFile({ filename: 'b.pdf' })]),
    );
    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(result.downloaded).toBe(1);
    expect(mockStreamToFile).toHaveBeenCalledTimes(2);
  });

  it('calls onProgress once per file plus an initial announcement', async () => {
    const onProgress = vi.fn();
    const lib = makeLibrary({ onProgress });
    // 2 bundles × 1 file each = total 2 files
    await lib.downloadBundles([makeBundleRef('k1'), makeBundleRef('k2')]);
    expect(onProgress).toHaveBeenCalledTimes(3); // announce + 2 files
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 2, 0); // announcement
    expect(onProgress).toHaveBeenNthCalledWith(2, 1, 2, 0); // file 1 done (bundle 1 not yet counted)
    expect(onProgress).toHaveBeenNthCalledWith(3, 2, 2, 1); // file 2 done (bundle 1 now counted)
  });

  it('calls onProgress once with total=0 when all files are filtered out', async () => {
    const onProgress = vi.fn();
    const lib = makeLibrary({ filters: ['epub'], onProgress });
    // Bundle only has a .pdf — it will be filtered
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(result.downloaded).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0, 0, 0);
  });

  it('creates output directory on first download', async () => {
    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef()]);
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('Test Bundle'), {
      recursive: true,
    });
  });

  it('does not create directory in dry-run mode', async () => {
    const lib = makeLibrary({ dryRun: true });
    await lib.downloadBundles([makeBundleRef()]);
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it('does not download in dry-run mode', async () => {
    const lib = makeLibrary({ dryRun: true });
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
  });

  it('filters files by extension when filters are set', async () => {
    mockFetchBundlePage.mockResolvedValue(
      makeBundle('k', 'Bundle', [
        makeFile({ filename: 'book.pdf' }),
        makeFile({ filename: 'book.epub' }),
      ]),
    );
    const lib = makeLibrary({ filters: ['epub'] });
    await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).toHaveBeenCalledOnce();
    expect(mockStreamToFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('book.epub'),
      expect.any(String),
    );
  });

  it('filter matching is case-insensitive', async () => {
    mockFetchBundlePage.mockResolvedValue(
      makeBundle('k', 'B', [makeFile({ filename: 'Book.PDF' })]),
    );
    const lib = makeLibrary({ filters: ['pdf'] });
    await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).toHaveBeenCalledOnce();
  });

  it('writes md5 sidecar after successful download', async () => {
    mockMd5sum.mockResolvedValue('abc123');
    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef()]);
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'abc123');
  });

  it('handles multiple bundles and accumulates downloaded count', async () => {
    mockFetchBundlePage
      .mockResolvedValueOnce(makeBundle('k1', 'Bundle A', [makeFile({ filename: 'a.pdf' })]))
      .mockResolvedValueOnce(makeBundle('k2', 'Bundle B', [makeFile({ filename: 'b.pdf' })]));

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef('k1'), makeBundleRef('k2')]);
    expect(result.downloaded).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Bundle page cache
// ---------------------------------------------------------------------------

describe('Library — bundle page cache', () => {
  it('uses cached page and skips fetchBundlePage when cache exists', async () => {
    const cachedPage = makeBundle('k', 'Cached Bundle', [makeFile()]);
    mockExistsSync.mockImplementation((p) => String(p).includes('.data/bundles'));
    mockReadFile.mockImplementation((p) =>
      String(p).includes('.data/bundles')
        ? Promise.resolve(JSON.stringify(cachedPage) as unknown as Buffer)
        : Promise.resolve('abc123' as unknown as Buffer),
    );

    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef('k')]);

    expect(mockFetchBundlePage).not.toHaveBeenCalled();
    expect(mockStreamToFile).toHaveBeenCalledOnce();
  });

  it('fetches from network and writes cache when no cached file exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef()]);

    expect(mockFetchBundlePage).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.data/bundles'),
      expect.any(String),
    );
  });

  it('bypasses cache and refetches when deep: true', async () => {
    mockExistsSync.mockImplementation((p) => String(p).includes('.data/bundles'));

    const lib = makeLibrary({ deep: true });
    await lib.downloadBundles([makeBundleRef()]);

    expect(mockFetchBundlePage).toHaveBeenCalledOnce();
  });

  it('falls back to network fetch when cached file contains invalid JSON', async () => {
    mockExistsSync.mockImplementation((p) => String(p).includes('.data/bundles'));
    mockReadFile.mockImplementation((p) =>
      String(p).includes('.data/bundles')
        ? Promise.resolve('not-json' as unknown as Buffer)
        : Promise.resolve('abc123' as unknown as Buffer),
    );

    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef()]);

    expect(mockFetchBundlePage).toHaveBeenCalledOnce();
  });

  it('does not write cache in dry-run mode', async () => {
    mockExistsSync.mockReturnValue(false);

    const lib = makeLibrary({ dryRun: true });
    await lib.downloadBundles([makeBundleRef()]);

    expect(mockFetchBundlePage).toHaveBeenCalledOnce();
    const cacheWrite = mockWriteFile.mock.calls.find(([p]) => String(p).includes('.data/bundles'));
    expect(cacheWrite).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shallow skip (default mode)
// ---------------------------------------------------------------------------

describe('Library.downloadBundles — shallow skip', () => {
  it('skips a bundle whose directory already has files (shallow mode)', async () => {
    const onProgress = vi.fn();
    // Dir exists and contains a visible file
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['book.pdf'] as unknown as ReturnType<typeof readdirSync>);

    const lib = makeLibrary({ onProgress });
    const result = await lib.downloadBundles([makeBundleRef()]);

    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
    // Announcement + one batch-skip call for the skipped bundle's files
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 1, 0);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1, 1, 0);
  });

  it('does not skip when deep: true even if directory has files', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['book.pdf'] as unknown as ReturnType<typeof readdirSync>);
    // Sidecar md5 matches → per-file skip path
    mockReadFile.mockResolvedValue('abc123' as unknown as Buffer);

    const lib = makeLibrary({ deep: true });
    const result = await lib.downloadBundles([makeBundleRef()]);

    // Deep mode enters per-file check; sidecar matches so no download, but no shallow skip
    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
    // fetchBundlePage was called (we didn't short-circuit before it)
    expect(mockFetchBundlePage).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// File skip logic
// ---------------------------------------------------------------------------

describe('Library.downloadBundles — file skip logic', () => {
  it('skips file when sidecar md5 matches', async () => {
    // Both outPath and sidecarPath exist
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue('abc123' as unknown as Buffer);

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
  });

  it('writes sidecar and skips when computed md5 matches but sidecar absent', async () => {
    // File exists, sidecar does not
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('.md5'));
    mockMd5sum.mockResolvedValue('abc123');

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'abc123');
    expect(result.downloaded).toBe(0);
  });

  it('moves file to old/ and re-downloads when md5 mismatches', async () => {
    // File exists, sidecar does not
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('.md5'));
    // md5 of existing file does NOT match what the server reports
    mockMd5sum.mockResolvedValue('differenthash');

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('old'), { recursive: true });
    expect(mockRename).toHaveBeenCalledWith(
      expect.stringContaining('book.pdf'),
      expect.stringMatching(/old\/\d{4}-\d{2}-\d{2}-book\.pdf$/),
    );
    expect(mockStreamToFile).toHaveBeenCalledOnce();
    expect(result.downloaded).toBe(1);
  });

  it('does not mkdir or rename on checksum mismatch in dry-run mode', async () => {
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('.md5'));
    mockMd5sum.mockResolvedValue('differenthash');

    const lib = makeLibrary({ dryRun: true });
    await lib.downloadBundles([makeBundleRef()]);

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockStreamToFile).not.toHaveBeenCalled();
  });

  it('skips re-download when sidecar hash mismatches but re-reads as mismatch', async () => {
    // Both file and sidecar exist
    mockExistsSync.mockReturnValue(true);
    // Sidecar content is different from expected md5
    mockReadFile.mockResolvedValue('stale_hash' as unknown as Buffer);
    mockMd5sum.mockResolvedValue('differenthash');

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);

    // Should move to old/ and re-download
    expect(mockRename).toHaveBeenCalledWith(
      expect.stringContaining('book.pdf'),
      expect.stringMatching(/old\/\d{4}-\d{2}-\d{2}-book\.pdf$/),
    );
    expect(mockStreamToFile).toHaveBeenCalledOnce();
    expect(result.downloaded).toBe(1);
  });

  it('skips without md5 check when file has no md5 in bundle metadata', async () => {
    mockFetchBundlePage.mockResolvedValue(makeBundle('k', 'B', [makeFile({ md5: '' })]));
    // File exists, no md5 to check → just skip
    mockExistsSync.mockReturnValue(true);

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);
    expect(mockStreamToFile).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Library.downloadBundles — error handling', () => {
  it('writes to errors.txt when streamToFile throws', async () => {
    mockStreamToFile.mockRejectedValue(new Error('network error'));

    const lib = makeLibrary();
    const result = await lib.downloadBundles([makeBundleRef()]);

    expect(result.errors).toBe(1);
    expect(mockAppendFile).toHaveBeenCalledWith(
      '/output/.data/errors.txt',
      expect.stringContaining('network error'),
    );
  });

  it('logs error and continues when a single file fails', async () => {
    const logger = vi.fn();
    mockStreamToFile.mockRejectedValue(new Error('timeout'));

    const lib = makeLibrary({ logger });
    await lib.downloadBundles([makeBundleRef()]);

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Download failed'));
  });

  it('includes bundle name and filename in errors.txt entry', async () => {
    mockStreamToFile.mockRejectedValue(new Error('disk full'));
    mockFetchBundlePage.mockResolvedValue(makeBundle('k', 'My Bundle'));

    const lib = makeLibrary();
    await lib.downloadBundles([makeBundleRef('k', 'My Bundle')]);

    expect(mockAppendFile).toHaveBeenCalledWith(
      '/output/.data/errors.txt',
      expect.stringContaining('My Bundle'),
    );
    expect(mockAppendFile).toHaveBeenCalledWith(
      '/output/.data/errors.txt',
      expect.stringContaining('book.pdf'),
    );
  });
});

// ---------------------------------------------------------------------------
// listBundles
// ---------------------------------------------------------------------------

describe('Library.listBundles', () => {
  it('logs titles and filenames', async () => {
    const logger = vi.fn();
    const lib = makeLibrary({ logger });
    await lib.listBundles([makeBundleRef()]);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Test Bundle'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('book.pdf'));
  });

  it('skips bundles where all files are filtered out', async () => {
    const logger = vi.fn();
    const lib = makeLibrary({ filters: ['epub'], logger });
    await lib.listBundles([makeBundleRef()]);
    // No log calls because the .pdf file gets filtered
    expect(logger).not.toHaveBeenCalled();
  });
});
