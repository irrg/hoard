import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn(), readdirSync: vi.fn() }));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  appendFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils.js')>();
  return { ...actual, download: vi.fn(), md5sum: vi.fn() };
});

import { existsSync, readdirSync } from 'fs';
import { readFile, writeFile, mkdir, rename, unlink, appendFile } from 'fs/promises';

import { Game } from '../src/game.js';
import type { Upload } from '../src/game.js';
import { download, md5sum, NoDownloadError } from '../src/utils.js';

const gameData = {
  id: 1111,
  game_id: 9999,
  game: {
    title: 'Test Game',
    user: { username: 'dev' },
    url: 'https://dev.itch.io/test-game',
    id: 9999,
  },
};

function makeGame(logger?: (msg: string) => void, deep = false, keepOld = false) {
  return new Game(
    gameData,
    false,
    'downloads',
    false,
    logger ?? (() => {}),
    deep,
    undefined,
    keepOld,
  );
}

function makeUpload(overrides: Partial<Upload> = {}): Upload {
  return { id: 42, filename: 'game.zip', md5_hash: 'abc123', ...overrides };
}

function mockSession(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce({
    status: 200,
    json: async () => ({ uuid: 'test-uuid' }),
  });
}

describe('Game.loadDownloads', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('populates downloads from API response', async () => {
    const uploads = [makeUpload(), makeUpload({ id: 43, filename: 'manual.pdf' })];
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ uploads }),
    });
    const g = makeGame();
    await g.loadDownloads('tok');
    expect(g.downloads).toHaveLength(2);
  });

  it('includes download_key_id when game has an owned-key id', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ uploads: [] }) });
    await makeGame().loadDownloads('tok');
    expect(fetchMock.mock.calls[0][0]).toContain('download_key_id=1111');
  });

  it('omits download_key_id for games without an owned-key id', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ uploads: [] }) });
    await new Game({ game: gameData.game }).loadDownloads('tok');
    expect(fetchMock.mock.calls[0][0]).not.toContain('download_key_id');
  });

  it('throws on JSON parse failure', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('bad');
      },
    });
    await expect(makeGame().loadDownloads('tok')).rejects.toThrow('Failed to parse downloads');
  });

  it('leaves downloads empty on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({}) });
    const g = makeGame();
    await g.loadDownloads('tok');
    expect(g.downloads).toHaveLength(0);
  });
});

describe('Game.download (shallow mode)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
  });

  it('skips immediately when dir has files and deep is false', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['game.zip'] as unknown as ReturnType<
      typeof readdirSync
    >);
    const result = await makeGame().download('tok');
    expect(result).toEqual({ newFiles: 0, errors: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proceeds when dir has files but deep is true', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['game.zip'] as unknown as ReturnType<
      typeof readdirSync
    >);
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({ uploads: [] }) });
    const result = await makeGame(undefined, true).download('tok');
    expect(result).toEqual({ newFiles: 0, errors: 0 }); // no uploads — but API was called
    expect(fetchMock).toHaveBeenCalled();
  });

  it('proceeds when dir is empty even in shallow mode', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({ uploads: [] }) });
    await makeGame().download('tok');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('proceeds when dir does not exist in shallow mode', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({ uploads: [] }) });
    await makeGame().download('tok');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns errors: 1 when loadDownloads throws (JSON parse failure)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    const result = await makeGame().download('tok');
    expect(result).toEqual({ newFiles: 0, errors: 1 });
  });

  it('returns errors: 0 when loadDownloads gets non-ok HTTP (expected no-access)', async () => {
    fetchMock.mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({}) });
    const result = await makeGame().download('tok');
    expect(result).toEqual({ newFiles: 0, errors: 0 });
  });
});

describe('Game.download — case-collision disambiguation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(download).mockResolvedValue(undefined);
    vi.mocked(md5sum).mockResolvedValue('abc123');
  });

  it('appends upload id to disambiguate case-colliding filenames', async () => {
    const uploads = [
      { id: 11, filename: 'And the Gunslinger Followed.pdf', md5_hash: 'aaa' },
      { id: 22, filename: 'And The Gunslinger Followed.pdf', md5_hash: 'bbb' },
    ];
    fetchMock
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ uploads }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ uuid: 'u1' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ uuid: 'u2' }) });
    await makeGame().download('tok');
    // download() is called with the .partial filename; strip suffix to check disambiguation
    const downloadedFiles = vi
      .mocked(download)
      .mock.calls.map((c) => String(c[3]).replace('.partial', ''));
    expect(downloadedFiles).toContain('And the Gunslinger Followed_11.pdf');
    expect(downloadedFiles).toContain('And The Gunslinger Followed_22.pdf');
  });

  it('does not append id when filenames differ after lowercasing', async () => {
    const uploads = [
      { id: 11, filename: 'readme.txt', md5_hash: 'aaa' },
      { id: 22, filename: 'manual.pdf', md5_hash: 'bbb' },
    ];
    fetchMock
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ uploads }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ uuid: 'u1' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ uuid: 'u2' }) });
    await makeGame().download('tok');
    // download() is called with the .partial filename; strip suffix to check disambiguation
    const downloadedFiles = vi
      .mocked(download)
      .mock.calls.map((c) => String(c[3]).replace('.partial', ''));
    expect(downloadedFiles).toContain('readme.txt');
    expect(downloadedFiles).toContain('manual.pdf');
  });
});

describe('Game.doDownload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(appendFile).mockResolvedValue(undefined);
    vi.mocked(download).mockResolvedValue(undefined);
    vi.mocked(md5sum).mockResolvedValue('abc123');
  });

  it('fetches a session UUID and downloads the file', async () => {
    mockSession(fetchMock);
    await makeGame().doDownload(makeUpload(), 'mytoken', 'game.zip');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('download-sessions'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('uuid=test-uuid'),
      expect.any(String),
      'Test Game',
      'game.zip.partial',
      expect.any(Function),
    );
  });

  it('includes download_key_id in download URL for owned-key games', async () => {
    mockSession(fetchMock);
    const result = await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(result).toBe('downloaded');
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('download_key_id=1111'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Function),
    );
  });

  it('writes .md5 sidecar after successful verified download', async () => {
    mockSession(fetchMock);
    vi.mocked(md5sum).mockResolvedValue('abc123');
    const result = await makeGame().doDownload(
      makeUpload({ md5_hash: 'abc123' }),
      'tok',
      'game.zip',
    );
    expect(result).toBe('downloaded');
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'abc123');
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining('game.zip.partial'),
      expect.stringContaining('game.zip'),
    );
  });

  it('keeps watermarked file, writes actual md5 to sidecar, returns downloaded when post-download MD5 differs', async () => {
    mockSession(fetchMock);
    vi.mocked(md5sum).mockResolvedValue('wrong-hash');
    const logSpy = vi.fn();
    const result = await makeGame(logSpy).doDownload(
      makeUpload({ md5_hash: 'abc123' }),
      'tok',
      'game.zip',
    );
    expect(result).toBe('downloaded');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('downloaded checksum differs from API'),
    );
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining('.partial'),
      expect.not.stringContaining('.partial'),
    );
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'wrong-hash');
  });

  it('skips when file exists and has no md5_hash', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const result = await makeGame().doDownload(
      makeUpload({ md5_hash: undefined }),
      'tok',
      'game.zip',
    );
    expect(result).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('skips when .md5 sidecar matches', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue('abc123' as unknown as Buffer);
    const result = await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(result).toBe('skipped');
    expect(download).not.toHaveBeenCalled();
  });

  it('skips and writes sidecar when computed MD5 matches and sidecar is absent', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(md5sum).mockResolvedValue('abc123');
    const result = await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(result).toBe('skipped');
    expect(download).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'abc123');
  });

  it('moves file to old/ and re-downloads on .md5 sidecar mismatch (keepOld=true)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue('old-hash' as unknown as Buffer);
    mockSession(fetchMock);
    await makeGame(undefined, false, true).doDownload(makeUpload(), 'tok', 'game.zip');
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining('game.zip'),
      expect.stringContaining('old'),
    );
    expect(download).toHaveBeenCalled();
  });

  it('writes actual md5 to sidecar and skips when computed MD5 differs from API (no sidecar, watermark case)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(md5sum).mockResolvedValue('different-hash');
    const result = await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(result).toBe('skipped');
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'different-hash');
    expect(download).not.toHaveBeenCalled();
  });

  it('returns error without downloading when session request fails', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => {
        throw new SyntaxError('bad');
      },
    });
    const result = await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(result).toBe('error');
    expect(download).not.toHaveBeenCalled();
  });

  it('returns skipped (not error) on NoDownloadError (web-only game)', async () => {
    mockSession(fetchMock);
    vi.mocked(download).mockRejectedValue(new NoDownloadError('no headers'));
    const result = await makeGame().doDownload(makeUpload(), 'secret-key', 'game.zip');
    expect(result).toBe('skipped');
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('logs to errors.txt on generic Error', async () => {
    mockSession(fetchMock);
    vi.mocked(download).mockRejectedValue(new Error('network failure'));
    await makeGame().doDownload(makeUpload(), 'tok', 'game.zip');
    expect(appendFile).toHaveBeenCalledWith(
      'downloads/.data/errors.txt',
      expect.stringContaining('game.zip'),
    );
  });

  it('deep mode bypasses sidecar and writes actual md5 to sidecar when hash differs from API', async () => {
    // outFile exists, sidecar exists — deep mode skips sidecar trust, computes actual hash
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue('abc123' as unknown as Buffer);
    vi.mocked(md5sum).mockResolvedValue('different-hash'); // actual differs from API
    const result = await makeGame(undefined, true).doDownload(makeUpload(), 'tok', 'game.zip');
    expect(readFile).not.toHaveBeenCalled(); // sidecar bypassed
    expect(result).toBe('skipped');
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.md5'), 'different-hash');
  });

  it('quarantine path includes milliseconds and random suffix (keepOld=true)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue('old-hash' as unknown as Buffer);
    vi.mocked(md5sum).mockResolvedValue('abc123');
    mockSession(fetchMock);
    await makeGame(undefined, false, true).doDownload(makeUpload(), 'tok', 'game.zip');
    const quarantineCall = vi
      .mocked(rename)
      .mock.calls.find(([, dest]) => String(dest).includes('old'));
    expect(quarantineCall).toBeDefined();
    expect(quarantineCall![1]).toMatch(
      /old\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}-game\.zip$/,
    );
  });
});
