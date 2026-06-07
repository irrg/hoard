import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { cleanPath, md5sum, runConcurrently, streamToFile, NoDownloadError } from '../src/utils.js';

// ---------------------------------------------------------------------------
// cleanPath
// ---------------------------------------------------------------------------

describe('cleanPath', () => {
  it('replaces forbidden characters with hyphens', () => {
    expect(cleanPath('foo<bar>baz')).toBe('foo-bar-baz');
    expect(cleanPath('a:b|c?d*e"f/g\\h')).toBe('a-b-c-d-e-f-g-h');
  });

  it('replaces consecutive dots with a hyphen', () => {
    expect(cleanPath('a..b')).toBe('a-b');
    expect(cleanPath('a...b')).toBe('a-b');
  });

  it('leaves normal path segments alone', () => {
    expect(cleanPath('Bundle of Holding 2024')).toBe('Bundle of Holding 2024');
  });

  it('handles empty string', () => {
    expect(cleanPath('')).toBe('');
  });

  it('handles a single dot without modification', () => {
    expect(cleanPath('a.b')).toBe('a.b');
  });
});

// ---------------------------------------------------------------------------
// NoDownloadError
// ---------------------------------------------------------------------------

describe('NoDownloadError', () => {
  it('is an instance of Error', () => {
    const e = new NoDownloadError('oops');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NoDownloadError');
    expect(e.message).toBe('oops');
  });
});

// ---------------------------------------------------------------------------
// runConcurrently
// ---------------------------------------------------------------------------

describe('runConcurrently', () => {
  it('runs all tasks', async () => {
    const results: number[] = [];
    const tasks = [1, 2, 3].map((n) => async () => {
      results.push(n);
    });
    await runConcurrently(tasks, 2);
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((r) => setTimeout(r, 5));
      active--;
    });
    await runConcurrently(tasks, 2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('resolves immediately for empty task list', async () => {
    await expect(runConcurrently([], 4)).resolves.toBeUndefined();
  });

  it('propagates a task error', async () => {
    const tasks = [
      async () => {},
      async () => {
        throw new Error('task failed');
      },
    ];
    await expect(runConcurrently(tasks, 2)).rejects.toThrow('task failed');
  });
});

// ---------------------------------------------------------------------------
// streamToFile
// ---------------------------------------------------------------------------

describe('streamToFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, body: null });
    await expect(streamToFile('http://example.com/file.pdf', '/tmp/out.pdf')).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('throws when response has no body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: null });
    await expect(streamToFile('http://example.com/file.pdf', '/tmp/out.pdf')).rejects.toThrow(
      'No response body',
    );
  });

  it('passes cookie header when provided', async () => {
    // We just want to check the header is forwarded; throw early so we don't need a real stream
    fetchMock.mockResolvedValue({ ok: false, status: 403, body: null });
    await expect(
      streamToFile('http://example.com/file.pdf', '/tmp/out.pdf', 'session=abc'),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/file.pdf',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=abc' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// md5sum
// ---------------------------------------------------------------------------

describe('md5sum', () => {
  it('returns the MD5 hex digest of a file', async () => {
    // Use the package.json itself as a stable file we know exists
    const hash = await md5sum(new URL('../package.json', import.meta.url).pathname);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects when the file does not exist', async () => {
    await expect(md5sum('/nonexistent/path/file.bin')).rejects.toThrow();
  });
});
