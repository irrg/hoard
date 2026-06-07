import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({ existsSync: mockExistsSync }));
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

import { isStorefront, STOREFRONTS, readConfig, writeConfig } from '../src/config.js';

describe('isStorefront', () => {
  it('accepts all valid storefronts', () => {
    for (const sf of STOREFRONTS) {
      expect(isStorefront(sf)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isStorefront('steam')).toBe(false);
    expect(isStorefront('')).toBe(false);
    expect(isStorefront('ITCHIO')).toBe(false);
  });
});

describe('readConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('returns defaults when config file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const config = await readConfig();
    expect(config.HOARD_JOBS).toBe(4);
    expect(config.HOARD_OUTPUT_DIR).toBe('downloads');
    expect(config.HOARD_ITCHIO_USERNAME).toBe('');
  });

  it('merges stored values over defaults', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ HOARD_ITCHIO_USERNAME: 'robb', HOARD_JOBS: 8 }),
    );
    const config = await readConfig();
    expect(config.HOARD_ITCHIO_USERNAME).toBe('robb');
    expect(config.HOARD_JOBS).toBe(8);
    expect(config.HOARD_OUTPUT_DIR).toBe('downloads');
  });

  it('fills missing keys from defaults when file is partial', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({ HOARD_DRIVETHRU_API_KEY: 'key123' }));
    const config = await readConfig();
    expect(config.HOARD_DRIVETHRU_API_KEY).toBe('key123');
    expect(config.HOARD_ITCHIO_PASSWORD).toBe('');
    expect(config.HOARD_JOBS).toBe(4);
  });
});

describe('writeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('creates the config directory and writes JSON', async () => {
    const config = {
      HOARD_ITCHIO_USERNAME: 'robb',
      HOARD_ITCHIO_PASSWORD: 'secret',
      HOARD_HUMBLEBUNDLE_SESSION: '',
      HOARD_DRIVETHRU_API_KEY: '',
      HOARD_BUNDLEOFHOLDING_EMAIL: '',
      HOARD_BUNDLEOFHOLDING_PASSWORD: '',
      HOARD_BUNDLEOFHOLDING_COOKIE: '',
      HOARD_OUTPUT_DIR: 'downloads',
      HOARD_JOBS: 4,
    };
    await writeConfig(config);
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('.hoard'), { recursive: true });
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(JSON.parse(written).HOARD_ITCHIO_USERNAME).toBe('robb');
  });

  it('writes valid JSON ending with newline', async () => {
    const config = {
      HOARD_ITCHIO_USERNAME: '',
      HOARD_ITCHIO_PASSWORD: '',
      HOARD_HUMBLEBUNDLE_SESSION: '',
      HOARD_DRIVETHRU_API_KEY: '',
      HOARD_BUNDLEOFHOLDING_EMAIL: '',
      HOARD_BUNDLEOFHOLDING_PASSWORD: '',
      HOARD_BUNDLEOFHOLDING_COOKIE: '',
      HOARD_OUTPUT_DIR: 'downloads',
      HOARD_JOBS: 4,
    };
    await writeConfig(config);
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(written)).not.toThrow();
  });
});
