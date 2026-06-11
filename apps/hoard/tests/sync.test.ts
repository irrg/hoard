import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before any imports
// ---------------------------------------------------------------------------

const mockLoadOrders = vi.hoisted(() => vi.fn());
const mockDownloadLibrary = vi.hoisted(() => vi.fn());
const MockHumbleLibrary = vi.hoisted(
  () =>
    vi.fn(function (this: Record<string, unknown>) {
      this.loadOrders = mockLoadOrders;
      this.downloadLibrary = mockDownloadLibrary;
      this.bundles = [];
    }) as unknown as new (...args: unknown[]) => unknown,
);

vi.mock('@irrg/humblebundle-hoard', () => ({ Library: MockHumbleLibrary }));
vi.mock('@irrg/itchio-hoard', () => ({
  loginAPI: vi.fn().mockResolvedValue('tok'),
  Library: vi.fn(function (this: Record<string, unknown>) {
    this.loadOwnedGames = vi.fn().mockResolvedValue(undefined);
    this.games = [];
    this.downloadLibrary = vi.fn().mockResolvedValue({ downloaded: 0, errors: 0 });
  }),
}));
vi.mock('@irrg/drivethru-hoard', () => ({
  Library: vi.fn(function (this: Record<string, unknown>) {
    this.authenticate = vi.fn().mockResolvedValue(undefined);
    this.loadProducts = vi.fn().mockResolvedValue(undefined);
    this.products = [];
    this.downloadLibrary = vi.fn().mockResolvedValue({ downloaded: 0, errors: 0 });
  }),
}));
vi.mock('@irrg/bundleofholding-hoard', () => ({
  loginWeb: vi.fn().mockResolvedValue('cookie'),
  fetchCabinet: vi.fn().mockResolvedValue([]),
  Library: vi.fn(function (this: Record<string, unknown>) {
    this.downloadBundles = vi.fn().mockResolvedValue({ downloaded: 0, errors: 0 });
  }),
}));
vi.mock('cli-progress', () => ({
  default: {
    MultiBar: vi.fn(function (this: Record<string, unknown>) {
      this.create = vi.fn(() => ({ update: vi.fn(), setTotal: vi.fn() }));
      this.stop = vi.fn();
    }),
    Presets: { shades_classic: {} },
  },
}));

import { parseJobsArg } from '../src/config.js';
import { cmdSync } from '../src/sync.js';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    HOARD_ITCHIO_USERNAME: '',
    HOARD_ITCHIO_PASSWORD: '',
    HOARD_HUMBLEBUNDLE_SESSION: 'session-cookie',
    HOARD_DRIVETHRU_API_KEY: '',
    HOARD_BUNDLEOFHOLDING_EMAIL: '',
    HOARD_BUNDLEOFHOLDING_PASSWORD: '',
    HOARD_BUNDLEOFHOLDING_COOKIE: '',
    HOARD_OUTPUT_DIR: '/tmp/test-output',
    HOARD_JOBS: 4,
    ...overrides,
  };
}

describe('cmdSync — Humble partial inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when loadOrders reports failed orders', async () => {
    mockLoadOrders.mockResolvedValue({ failed: 2 });
    mockDownloadLibrary.mockResolvedValue({ downloaded: 0, errors: 0 });

    const result = await cmdSync(['humblebundle'], makeConfig(), '/tmp/out', 4, false, true);
    expect(result).toBe(false);
  });

  it('returns true when loadOrders has no failures and download has no errors', async () => {
    mockLoadOrders.mockResolvedValue({ failed: 0 });
    mockDownloadLibrary.mockResolvedValue({ downloaded: 3, errors: 0 });

    const result = await cmdSync(['humblebundle'], makeConfig(), '/tmp/out', 4, false, true);
    expect(result).toBe(true);
  });
});

describe('parseJobsArg', () => {
  it('parses a plain integer string', () => {
    expect(parseJobsArg('4', 1)).toBe(4);
  });

  it('returns NaN for "4x"', () => {
    expect(parseJobsArg('4x', 1)).toBeNaN();
  });

  it('returns NaN for "4.5"', () => {
    expect(parseJobsArg('4.5', 1)).toBeNaN();
  });

  it('returns NaN for empty string', () => {
    expect(parseJobsArg('', 1)).toBeNaN();
  });

  it('returns fallback when raw is undefined', () => {
    expect(parseJobsArg(undefined, 8)).toBe(8);
  });
});
