import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  existsSyncMock,
  writeFileMock,
  readFileMock,
  mkdirMock,
  renameMock,
  appendFileMock,
  streamToFileMock,
  md5sumMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(p: string) => boolean>(() => false),
  writeFileMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  readFileMock: vi.fn<() => Promise<string>>(() => Promise.resolve('')),
  mkdirMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  renameMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  appendFileMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  streamToFileMock: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  md5sumMock: vi.fn<() => Promise<string>>(() => Promise.resolve('aabbccdd')),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() })),
  createReadStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: writeFileMock,
  readFile: readFileMock,
  mkdir: mkdirMock,
  rename: renameMock,
  appendFile: appendFileMock,
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils.js')>();
  return {
    ...original,
    streamToFile: streamToFileMock,
    md5sum: md5sumMock,
  };
});

import { Bundle, BundleData, BundleOptions } from '../src/bundle.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<BundleOptions> = {}): BundleOptions {
  return {
    cookie: 'test-cookie',
    outputDir: '/tmp/hoard',
    platform: undefined,
    extInclude: [],
    extExclude: [],
    dryRun: false,
    filters: [],
    logger: vi.fn(),
    ...overrides,
  };
}

function makeData(overrides: Partial<BundleData> = {}): BundleData {
  return {
    product: { human_name: 'Test Bundle' },
    subproducts: [
      {
        human_name: 'My eBook',
        downloads: [
          {
            platform: 'ebook',
            download_struct: [
              { url: { web: 'https://dl.humblebundle.com/files/mybook.pdf' }, md5: 'aabbccdd' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bundle constructor
// ---------------------------------------------------------------------------

describe('Bundle constructor', () => {
  it('sets key, name, and title from data', () => {
    const b = new Bundle('key123', makeData(), makeOptions());
    expect(b.key).toBe('key123');
    expect(b.name).toBe('Test Bundle');
    expect(b.title).toBe('Test Bundle');
  });

  it('falls back to key when product.human_name is null/undefined', () => {
    const data = {
      product: { human_name: null as unknown as string },
      subproducts: [],
    } as BundleData;
    const b = new Bundle('fallback-key', data, makeOptions());
    expect(b.name).toBe('fallback-key');
  });

  it('uses empty string name when product.human_name is empty (nullish-coalescing)', () => {
    // ?? only falls back for null/undefined, not empty string
    const data = { product: { human_name: '' }, subproducts: [] } as BundleData;
    const b = new Bundle('fallback-key', data, makeOptions());
    expect(b.name).toBe('');
  });

  it('sanitizes the title via cleanPath', () => {
    const data = makeData({ product: { human_name: 'Bundle: The <Special> One' } });
    const b = new Bundle('k', data, makeOptions());
    expect(b.title).toBe('Bundle- The -Special- One');
  });

  it('tolerates missing subproducts by defaulting to empty array', () => {
    const data = { product: { human_name: 'X' } } as unknown as BundleData;
    const b = new Bundle('k', data, makeOptions());
    expect(b.subproducts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bundle.download — happy path
// ---------------------------------------------------------------------------

describe('Bundle.download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    streamToFileMock.mockResolvedValue(undefined);
    md5sumMock.mockResolvedValue('aabbccdd');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('downloads a file and returns newFiles=1', async () => {
    const b = new Bundle('k', makeData(), makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(1);
    expect(result.errors).toBe(0);
    expect(streamToFileMock).toHaveBeenCalledWith(
      'https://dl.humblebundle.com/files/mybook.pdf',
      expect.stringContaining('mybook.pdf'),
      'test-cookie',
    );
  });

  it('creates the output directory before downloading', async () => {
    const b = new Bundle('k', makeData(), makeOptions());
    await b.download();
    expect(mkdirMock).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('writes an md5 file after successful download', async () => {
    const b = new Bundle('k', makeData(), makeOptions());
    await b.download();
    expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('mybook.md5'), 'aabbccdd');
  });

  // -------------------------------------------------------------------------
  // skipping
  // -------------------------------------------------------------------------

  it('skips a file that already exists without md5 in API', async () => {
    existsSyncMock.mockReturnValue(true);
    const data = makeData();
    data.subproducts[0].downloads[0].download_struct[0].md5 = undefined;
    const b = new Bundle('k', data, makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('skips when stored md5 matches api md5', async () => {
    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith('.pdf') || p.endsWith('.md5');
    });
    readFileMock.mockResolvedValue('aabbccdd\n');
    const b = new Bundle('k', makeData(), makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('skips when computed md5 matches and no sidecar exists yet', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('.pdf'));
    md5sumMock.mockResolvedValue('aabbccdd');
    const b = new Bundle('k', makeData(), makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'aabbccdd');
  });

  it('re-downloads and renames old file when md5 mismatches', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('.pdf'));
    md5sumMock.mockResolvedValue('deadbeef');
    const b = new Bundle('k', makeData(), makeOptions());
    const result = await b.download();
    expect(renameMock).toHaveBeenCalled();
    expect(streamToFileMock).toHaveBeenCalled();
    expect(result.newFiles).toBe(1);
  });

  // -------------------------------------------------------------------------
  // dry run
  // -------------------------------------------------------------------------

  it('skips downloading in dry-run mode', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ dryRun: true }));
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('logs a dry-run message', async () => {
    const logger = vi.fn();
    const b = new Bundle('k', makeData(), makeOptions({ dryRun: true, logger }));
    await b.download();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/dry run/i));
  });

  // -------------------------------------------------------------------------
  // platform filtering
  // -------------------------------------------------------------------------

  it('skips subproducts whose platform does not match', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ platform: 'audio' }));
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('downloads when platform matches (case-insensitive)', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ platform: 'EBOOK' }));
    const result = await b.download();
    expect(result.newFiles).toBe(1);
  });

  // -------------------------------------------------------------------------
  // extension filtering
  // -------------------------------------------------------------------------

  it('skips files whose extension is not in extInclude', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ extInclude: ['epub'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('downloads when extension is in extInclude', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ extInclude: ['pdf'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(1);
  });

  it('skips files whose extension is in extExclude', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ extExclude: ['pdf'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(streamToFileMock).not.toHaveBeenCalled();
  });

  it('downloads when extension is NOT in extExclude', async () => {
    const b = new Bundle('k', makeData(), makeOptions({ extExclude: ['exe'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(1);
  });

  // -------------------------------------------------------------------------
  // subproduct filtering
  // -------------------------------------------------------------------------

  it('filters subproducts by name when filters option is set', async () => {
    const data = makeData({
      subproducts: [
        {
          human_name: 'Horror Novel',
          downloads: [
            {
              platform: 'ebook',
              download_struct: [
                { url: { web: 'https://dl.example.com/horror.pdf' }, md5: 'aabbccdd' },
              ],
            },
          ],
        },
        {
          human_name: 'Sci-Fi Novel',
          downloads: [
            {
              platform: 'ebook',
              download_struct: [
                { url: { web: 'https://dl.example.com/scifi.pdf' }, md5: 'aabbccdd' },
              ],
            },
          ],
        },
      ],
    });
    const b = new Bundle('k', data, makeOptions({ filters: ['horror'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(1);
    expect(streamToFileMock).toHaveBeenCalledWith(
      expect.stringContaining('horror.pdf'),
      expect.any(String),
      'test-cookie',
    );
  });

  it('is case-insensitive when matching filters', async () => {
    const data = makeData();
    const b = new Bundle('k', data, makeOptions({ filters: ['MY EBOOK'] }));
    const result = await b.download();
    expect(result.newFiles).toBe(1);
  });

  // -------------------------------------------------------------------------
  // error handling
  // -------------------------------------------------------------------------

  it('returns errors=1 when streamToFile rejects', async () => {
    streamToFileMock.mockRejectedValue(new Error('network error'));
    const b = new Bundle('k', makeData(), makeOptions());
    const result = await b.download();
    expect(result.errors).toBe(1);
    expect(result.newFiles).toBe(0);
  });

  it('writes to errors.txt when a download fails', async () => {
    streamToFileMock.mockRejectedValue(new Error('timeout'));
    const b = new Bundle('k', makeData(), makeOptions());
    await b.download();
    expect(appendFileMock).toHaveBeenCalledWith(
      expect.stringContaining('errors.txt'),
      expect.stringContaining('timeout'),
    );
  });

  it('logs checksum mismatch message after download if md5 differs', async () => {
    const logger = vi.fn();
    md5sumMock.mockResolvedValue('differenthash');
    const b = new Bundle('k', makeData(), makeOptions({ logger }));
    await b.download();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/md5 mismatch/i));
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  it('returns zero counts when there are no subproducts', async () => {
    const data = makeData({ subproducts: [] });
    const b = new Bundle('k', data, makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('silently skips a download item whose url.web is empty', async () => {
    // The guard `if (item.url?.web)` skips falsy URLs — not an error, just ignored
    const data = makeData({
      subproducts: [
        {
          human_name: 'Bad Product',
          downloads: [{ platform: 'ebook', download_struct: [{ url: { web: '' } }] }],
        },
      ],
    });
    const b = new Bundle('k', data, makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('handles multiple subproducts and sums results', async () => {
    const data = makeData({
      subproducts: [
        {
          human_name: 'Book A',
          downloads: [
            {
              platform: 'ebook',
              download_struct: [{ url: { web: 'https://dl.example.com/a.pdf' }, md5: 'aabbccdd' }],
            },
          ],
        },
        {
          human_name: 'Book B',
          downloads: [
            {
              platform: 'ebook',
              download_struct: [{ url: { web: 'https://dl.example.com/b.pdf' }, md5: 'aabbccdd' }],
            },
          ],
        },
      ],
    });
    const b = new Bundle('k', data, makeOptions());
    const result = await b.download();
    expect(result.newFiles).toBe(2);
    expect(result.errors).toBe(0);
  });
});
