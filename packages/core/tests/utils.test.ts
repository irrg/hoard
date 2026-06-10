import { createHash } from 'crypto';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, vi } from 'vitest';

import { NoDownloadError, fetchWithRetry, md5sum, runConcurrently } from '../src/utils.js';

describe('NoDownloadError', () => {
  it('is an Error with the right name', () => {
    const e = new NoDownloadError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NoDownloadError');
    expect(e.message).toBe('test');
  });
});

describe('md5sum', () => {
  it('returns the md5 of a file', async () => {
    const file = join(tmpdir(), `hoard-core-test-${Date.now()}.txt`);
    writeFileSync(file, 'hello world');
    const expected = createHash('md5').update('hello world').digest('hex');
    try {
      expect(await md5sum(file)).toBe(expected);
    } finally {
      unlinkSync(file);
    }
  });
});

describe('runConcurrently', () => {
  it('runs all tasks', async () => {
    const ran: number[] = [];
    const tasks = [0, 1, 2].map((i) => async () => {
      ran.push(i);
    });
    await runConcurrently(tasks, 2);
    expect(ran).toHaveLength(3);
  });

  it('limits concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await runConcurrently(tasks, 2);
    expect(maxActive).toBe(2);
  });

  it('re-throws task errors after draining', async () => {
    let completed = 0;
    const tasks: Array<() => Promise<void>> = [
      async () => {
        throw new Error('boom');
      },
      async () => {
        completed++;
      },
    ];
    await expect(runConcurrently(tasks, 2)).rejects.toThrow('boom');
    expect(completed).toBe(1);
  });
});

describe('fetchWithRetry', () => {
  it('returns response on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    const r = await fetchWithRetry('https://example.com');
    expect(r.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('retries on 429', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: { get: () => '0' },
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    const r = await fetchWithRetry('https://example.com', undefined, 3, () => {});
    expect(r.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
