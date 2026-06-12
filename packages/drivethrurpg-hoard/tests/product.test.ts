import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs and fs/promises before importing product
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  appendFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
}));

// Also mock the utils functions that do real I/O
vi.mock('../src/utils.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/utils.js')>();
  return {
    ...real,
    streamToFile: vi.fn(),
    md5sum: vi.fn(),
  };
});

import * as fsSync from 'fs';
import * as fsPromises from 'fs/promises';

import { Product } from '../src/product.js';
import type { ProductData, DownloadItemData, ProductOptions } from '../src/product.js';
import { streamToFile, md5sum } from '../src/utils.js';

const existsSyncMock = vi.mocked(fsSync.existsSync);
const readdirSyncMock = vi.mocked(fsSync.readdirSync);
const writeFileMock = vi.mocked(fsPromises.writeFile);
const readFileMock = vi.mocked(fsPromises.readFile);
const mkdirMock = vi.mocked(fsPromises.mkdir);
const renameMock = vi.mocked(fsPromises.rename);
const appendFileMock = vi.mocked(fsPromises.appendFile);
const statMock = vi.mocked(fsPromises.stat);
const streamToFileMock = vi.mocked(streamToFile);
const md5sumMock = vi.mocked(md5sum);

function makeProductData(overrides: Partial<ProductData> = {}): ProductData {
  return {
    productId: 'prod-123',
    orderProductId: 42,
    name: 'My RPG Product',
    publisher: { name: 'Acme Publisher' },
    fileLastModified: '2024-06-01T00:00:00Z',
    files: [{ index: 0, filename: 'my-rpg.pdf', checksums: null }],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ProductOptions> = {}): ProductOptions {
  return {
    outputDir: '/tmp/hoard',
    compat: false,
    omitPublisher: false,
    dryRun: false,
    logger: vi.fn(),
    ...overrides,
  };
}

function makeProduct(
  dataOverrides: Partial<ProductData> = {},
  optOverrides: Partial<ProductOptions> = {},
) {
  return new Product(makeProductData(dataOverrides), makeOptions(optOverrides));
}

function makeItem(overrides: Partial<DownloadItemData> = {}): DownloadItemData {
  return {
    index: 0,
    filename: 'my-rpg.pdf',
    checksums: null,
    ...overrides,
  };
}

describe('Product constructor', () => {
  it('sets name and publisher from data', () => {
    const p = makeProduct();
    expect(p.name).toBe('My RPG Product');
    expect(p.publisherName).toBe('Acme Publisher');
  });

  it('defaults publisher to "Others" when absent', () => {
    const p = makeProduct({ publisher: undefined });
    expect(p.publisherName).toBe('Others');
  });

  it('builds dir as outputDir/publisher/product by default', () => {
    const p = makeProduct();
    expect(p.dir).toContain('Acme Publisher');
    expect(p.dir).toContain('My RPG Product');
    expect(p.dir.startsWith('/tmp/hoard')).toBe(true);
  });

  it('omits publisher segment when omitPublisher is true', () => {
    const p = makeProduct({}, { omitPublisher: true });
    expect(p.dir).not.toContain('Acme Publisher');
    expect(p.dir).toContain('My RPG Product');
  });
});

describe('Product.download', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Default: file does not exist
    existsSyncMock.mockReturnValue(false);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    streamToFileMock.mockResolvedValue(undefined);
    md5sumMock.mockResolvedValue('abc123');
    appendFileMock.mockResolvedValue(undefined);
    // Default prepare response: ready immediately
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/file.pdf', status: 'Ready' }),
      headers: { get: () => null },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns { newFiles: 0, errors: 0 } immediately when the product has no files', async () => {
    const p = makeProduct({ files: [] });
    await expect(p.download('bearer-tok')).resolves.toEqual({ newFiles: 0, errors: 0 });
  });

  it('returns { newFiles: 0, errors: 0 } when all files are skipped (dry run)', async () => {
    const p = makeProduct({}, { dryRun: true });
    await expect(p.download('bearer-tok')).resolves.toEqual({ newFiles: 0, errors: 0 });
  });

  it('returns { newFiles: 1, errors: 0 } when a file is written', async () => {
    const p = makeProduct();
    await expect(p.download('bearer-tok')).resolves.toEqual({ newFiles: 1, errors: 0 });
  });

  it('writes the manifest JSON when a file is downloaded', async () => {
    const p = makeProduct();
    await p.download('bearer-tok');
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      expect.stringContaining('"My RPG Product"'),
    );
  });

  it('manifest JSON contains publisher, orderProductId, productId, fileLastModified', async () => {
    const p = makeProduct();
    await p.download('bearer-tok');
    const [, jsonStr] = writeFileMock.mock.calls.find(([path]) =>
      (path as string).endsWith('.json'),
    )! as [string, string];
    const parsed = JSON.parse(jsonStr);
    expect(parsed.publisher).toBe('Acme Publisher');
    expect(parsed.orderProductId).toBe(42);
    expect(parsed.productId).toBe('prod-123');
    expect(parsed.fileLastModified).toBe('2024-06-01T00:00:00Z');
  });

  it('does not write manifest when all files are skipped', async () => {
    // All files exist and checksums match → all skipped
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockResolvedValue('checksum-value' as unknown as Buffer);
    const item = makeItem({
      checksums: [{ checksum: 'checksum-value', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] });
    await p.download('bearer-tok');
    expect(writeFileMock).not.toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      expect.any(String),
    );
  });

  it('returns { newFiles: 0, errors: 0 } without any API calls when dir has files and deep is false', async () => {
    existsSyncMock.mockReturnValueOnce(true); // dir exists
    readdirSyncMock.mockReturnValueOnce(['file.pdf'] as unknown as ReturnType<
      typeof fsSync.readdirSync
    >);
    const p = makeProduct();
    const result = await p.download('tok');
    expect(result).toEqual({ newFiles: 0, errors: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not skip when deep is true even if dir has files', async () => {
    existsSyncMock.mockReturnValueOnce(false); // outFile does not exist → download
    const p = makeProduct({}, { deep: true } as any);
    const result = await p.download('tok');
    expect(result).toEqual({ newFiles: 1, errors: 0 });
  });
});

describe('Product.doDownload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    existsSyncMock.mockReturnValue(false);
    readdirSyncMock.mockReturnValue([] as unknown as ReturnType<typeof fsSync.readdirSync>);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    streamToFileMock.mockResolvedValue(undefined);
    md5sumMock.mockResolvedValue('abc123');
    appendFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    // Default prepare response: ready
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: 'https://cdn.example.com/file.pdf', status: 'Ready' }),
      headers: { get: () => null },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns skipped in dry run mode without downloading', async () => {
    const p = makeProduct({}, { dryRun: true });
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('skipped');
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('downloads and returns downloaded when file does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    const p = makeProduct();
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('downloaded');
    expect(streamToFileMock).toHaveBeenCalledWith(
      'https://cdn.example.com/file.pdf',
      expect.any(String),
    );
  });

  it('skips when file exists and md5 sidecar matches API checksum', async () => {
    existsSyncMock.mockReturnValue(true); // both outFile and md5File exist
    readFileMock.mockResolvedValue('matching-checksum' as unknown as Buffer);
    const item = makeItem({
      checksums: [{ checksum: 'matching-checksum', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] });
    const result = await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(result).toBe('skipped');
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('re-downloads when file exists but md5 sidecar does not match', async () => {
    // outFile exists, md5File exists, but checksums differ
    existsSyncMock
      .mockReturnValueOnce(true) // outFile exists
      .mockReturnValueOnce(true) // md5File exists
      .mockReturnValue(false); // subsequent checks
    readFileMock.mockResolvedValue('old-checksum' as unknown as Buffer);
    const item = makeItem({
      checksums: [{ checksum: 'new-checksum', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    md5sumMock.mockResolvedValue('new-checksum'); // post-download matches api checksum
    const p = makeProduct({ files: [item] });
    const result = await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(result).toBe('downloaded');
    expect(renameMock).toHaveBeenCalled(); // old file quarantined, then partial→final rename
    expect(streamToFileMock).toHaveBeenCalled();
  });

  it('skips when file exists, no checksum, and mtime is newer than remote', async () => {
    // checksums: null → apiChecksum is null → existsSync(md5File) is never called (short-circuit)
    existsSyncMock.mockReturnValueOnce(true); // outFile exists
    statMock.mockResolvedValue({ mtimeMs: Date.now() + 100000 } as unknown as import('fs').Stats);
    const p = makeProduct({ fileLastModified: '2020-01-01T00:00:00Z' });
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('skipped');
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('re-downloads when file exists, no checksum, and mtime is older than remote', async () => {
    // checksums: null → apiChecksum is null → existsSync(md5File) is never called (short-circuit)
    existsSyncMock.mockReturnValueOnce(true); // outFile exists
    statMock.mockResolvedValue({ mtimeMs: 0 } as unknown as import('fs').Stats);
    const p = makeProduct({ fileLastModified: '2099-01-01T00:00:00Z' });
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('downloaded');
    expect(renameMock).toHaveBeenCalled();
    expect(streamToFileMock).toHaveBeenCalled();
  });

  it('writes md5 sidecar after successful download when checksum matches', async () => {
    existsSyncMock.mockReturnValue(false);
    md5sumMock.mockResolvedValue('expected-hash');
    const item = makeItem({
      checksums: [{ checksum: 'expected-hash', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] });
    await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'expected-hash');
  });

  it('keeps watermarked file, writes actual md5 to sidecar, returns downloaded when post-download checksum differs', async () => {
    existsSyncMock.mockReturnValue(false);
    md5sumMock.mockResolvedValue('wrong-hash');
    const item = makeItem({
      checksums: [{ checksum: 'expected-hash', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] });
    const result = await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(result).toBe('downloaded');
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringContaining('.partial'),
      expect.not.stringContaining('.partial'),
    );
    expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'wrong-hash');
  });

  it('does not write md5 sidecar when no checksum is available', async () => {
    existsSyncMock.mockReturnValue(false);
    const item = makeItem({ checksums: null });
    const p = makeProduct({ files: [item] });
    await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(writeFileMock).not.toHaveBeenCalledWith(
      expect.stringContaining('.md5'),
      expect.any(String),
    );
  });

  it('returns error and logs when _prepareDownloadUrl fails', async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false, headers: { get: () => null } });
    existsSyncMock.mockReturnValue(false);
    const logger = vi.fn();
    const p = makeProduct({}, { logger });
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('error');
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Could not get download link'));
    expect(appendFileMock).toHaveBeenCalled();
  });

  it('returns error and logs when streamToFile throws', async () => {
    existsSyncMock.mockReturnValue(false);
    streamToFileMock.mockRejectedValue(new Error('network error'));
    const logger = vi.fn();
    const p = makeProduct({}, { logger });
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('error');
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Download failed'));
    expect(appendFileMock).toHaveBeenCalled();
  });

  it('polls the check endpoint while status starts with "Preparing"', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock
      // prepare call → Preparing
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: '', status: 'Preparing' }),
        headers: { get: () => null },
      })
      // check call → Ready
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: 'https://cdn.example.com/ready.pdf', status: 'Ready' }),
        headers: { get: () => null },
      });

    vi.useFakeTimers();
    const p = makeProduct();
    const promise = p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('downloaded');
    // prepare + check = 2 fetch calls (plus later streamToFile which uses its own fetch)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('prepare'), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('check'), expect.any(Object));
    vi.useRealTimers();
  });

  it('returns error when prepare response has no URL', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: '', status: 'Ready' }),
      headers: { get: () => null },
    });
    const p = makeProduct();
    const result = await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(result).toBe('error');
    expect(appendFileMock).toHaveBeenCalled();
  });

  it('sends Authorization header in prepare request', async () => {
    existsSyncMock.mockReturnValue(false);
    const p = makeProduct();
    await p.doDownload(makeItem(), 'my-bearer-token', 'my-rpg.pdf');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('prepare'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'my-bearer-token' }),
      }),
    );
  });

  it('creates the output directory before downloading', async () => {
    existsSyncMock.mockReturnValue(false);
    const p = makeProduct();
    await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('Acme Publisher'), {
      recursive: true,
    });
  });

  it('uses the newest checksum when multiple checksums are present', async () => {
    existsSyncMock
      .mockReturnValueOnce(true) // outFile exists
      .mockReturnValueOnce(true); // md5File exists
    readFileMock.mockResolvedValue('newest-checksum' as unknown as Buffer);
    const item = makeItem({
      checksums: [
        { checksum: 'older-checksum', checksumDate: '2022-01-01T00:00:00Z' },
        { checksum: 'newest-checksum', checksumDate: '2024-01-01T00:00:00Z' },
      ],
    });
    const p = makeProduct({ files: [item] });
    const result = await p.doDownload(item, 'tok', 'my-rpg.pdf');
    // newest checksum matches stored → skip
    expect(result).toBe('skipped');
  });

  it('returns the orderProductId in the prepare URL', async () => {
    existsSyncMock.mockReturnValue(false);
    const p = makeProduct({ orderProductId: 999 });
    await p.doDownload(makeItem(), 'tok', 'my-rpg.pdf');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/order_products/999/prepare'),
      expect.any(Object),
    );
  });

  it('deep mode bypasses sidecar and writes actual md5 to sidecar when hash differs from API', async () => {
    // outFile exists, sidecar exists — deep mode skips sidecar trust, computes actual hash
    existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);
    readFileMock.mockResolvedValue('api-checksum' as unknown as Buffer);
    md5sumMock.mockResolvedValue('different-local'); // actual differs from API
    const item = makeItem({
      checksums: [{ checksum: 'api-checksum', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] }, { deep: true } as any);
    const result = await p.doDownload(item, 'tok', 'my-rpg.pdf');
    expect(readFileMock).not.toHaveBeenCalled(); // sidecar bypassed
    expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'different-local');
    expect(result).toBe('skipped');
  });

  it('quarantine path includes milliseconds and random suffix (keepOld=true)', async () => {
    existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);
    readFileMock.mockResolvedValue('old-hash' as unknown as Buffer);
    md5sumMock.mockResolvedValue('api-checksum');
    const item = makeItem({
      checksums: [{ checksum: 'api-checksum', checksumDate: '2024-01-01T00:00:00Z' }],
    });
    const p = makeProduct({ files: [item] }, { keepOld: true });
    await p.doDownload(item, 'tok', 'my-rpg.pdf');
    const quarantineCall = renameMock.mock.calls.find(([, dest]) => String(dest).includes('old'));
    expect(quarantineCall).toBeDefined();
    expect(quarantineCall![1]).toMatch(
      /old\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}-my-rpg\.pdf$/,
    );
  });
});
