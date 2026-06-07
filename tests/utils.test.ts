import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, cleanPath, runConcurrently } from '../src/utils.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return { status, ok: status < 400, json: async () => body, headers: new Headers() };
}

function mockResponseWithHeader(body: unknown, status: number, headerName: string, headerValue: string) {
  const headers = new Headers({ [headerName]: headerValue });
  return { status, ok: status < 400, json: async () => body, headers };
}

// ---------------------------------------------------------------------------
// fetchWithRetry
// ---------------------------------------------------------------------------

describe('fetchWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the response on success', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true }, 200));
    const r = await fetchWithRetry('https://example.com/api');
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes URL and options to fetch', async () => {
    fetchMock.mockResolvedValue(mockResponse({}, 200));
    await fetchWithRetry('https://example.com/test', { headers: { Authorization: 'Bearer token' } });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/test', {
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('returns non-429 error responses without retrying', async () => {
    fetchMock.mockResolvedValue(mockResponse({}, 500));
    const r = await fetchWithRetry('https://example.com/api', undefined, 3);
    expect(r.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 without retrying', async () => {
    fetchMock.mockResolvedValue(mockResponse({}, 404));
    const r = await fetchWithRetry('https://example.com/api', undefined, 3);
    expect(r.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 up to the retry limit', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({}, 429))
      .mockResolvedValueOnce(mockResponse({}, 429))
      .mockResolvedValue(mockResponse({}, 200));

    const logger = vi.fn();
    const promise = fetchWithRetry('https://example.com/api', undefined, 3, logger);

    // Advance through both waits
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after exhausting retry count and returns the 429', async () => {
    fetchMock.mockResolvedValue(mockResponse({}, 429));

    const logger = vi.fn();
    const promise = fetchWithRetry('https://example.com/api', undefined, 2, logger);
    await vi.runAllTimersAsync();
    const r = await promise;

    // 1 initial + 2 retries = 3 calls; on the 3rd attempt >= retries so returns
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses retry-after header when present', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponseWithHeader({}, 429, 'retry-after', '5'))
      .mockResolvedValue(mockResponse({}, 200));

    const logger = vi.fn();
    const promise = fetchWithRetry('https://example.com/api', undefined, 3, logger);
    await vi.runAllTimersAsync();
    await promise;

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('5s'));
  });

  it('logs rate-limit message when retrying', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({}, 429))
      .mockResolvedValue(mockResponse({}, 200));

    const logger = vi.fn();
    const promise = fetchWithRetry('https://example.com/api', undefined, 3, logger);
    await vi.runAllTimersAsync();
    await promise;

    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/rate limited/i));
  });
});

// ---------------------------------------------------------------------------
// cleanPath
// ---------------------------------------------------------------------------

describe('cleanPath', () => {
  it('replaces forbidden characters with hyphens', () => {
    expect(cleanPath('foo<bar>baz')).toBe('foo-bar-baz');
    expect(cleanPath('a:b|c?d*e"f/g\\h')).toBe('a-b-c-d-e-f-g-h');
  });

  it('trims leading/trailing whitespace', () => {
    expect(cleanPath('  hello world  ')).toBe('hello world');
  });

  it('leaves safe characters untouched', () => {
    expect(cleanPath('Humble Book Bundle - Horror 2023')).toBe('Humble Book Bundle - Horror 2023');
  });

  it('handles empty string', () => {
    expect(cleanPath('')).toBe('');
  });

  it('handles a string that is only special characters', () => {
    expect(cleanPath('<>')).toBe('--');
  });

  it('replaces trailing repeated dot-char sequences with a hyphen', () => {
    // e.g. "foo..." → the regex (.)[.]\\1+$ replaces the trailing "..." with "-"
    const result = cleanPath('foo...');
    expect(result).toBe('foo-');
  });
});

// ---------------------------------------------------------------------------
// runConcurrently
// ---------------------------------------------------------------------------

describe('runConcurrently', () => {
  it('runs all tasks and resolves', async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3].map((n) => async () => {
      order.push(n);
    });
    await runConcurrently(tasks, 2);
    expect(order).toEqual([1, 2, 3]);
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((r) => setImmediate(r));
      running--;
    });
    await runConcurrently(tasks, 3);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it('resolves with an empty task list', async () => {
    await expect(runConcurrently([], 4)).resolves.toBeUndefined();
  });

  it('runs a single task when limit is 1', async () => {
    const executed: number[] = [];
    const tasks = [1, 2, 3].map((n) => async () => {
      executed.push(n);
    });
    await runConcurrently(tasks, 1);
    expect(executed).toEqual([1, 2, 3]);
  });

  it('propagates the first task error', async () => {
    const tasks = [
      async () => {
        throw new Error('task failed');
      },
      async () => {},
    ];
    await expect(runConcurrently(tasks, 2)).rejects.toThrow('task failed');
  });

  it('captures errors and still runs remaining tasks', async () => {
    const executed: number[] = [];
    const tasks = [
      async () => {
        throw new Error('oops');
      },
      async () => {
        executed.push(2);
      },
      async () => {
        executed.push(3);
      },
    ];
    await expect(runConcurrently(tasks, 3)).rejects.toThrow('oops');
    expect(executed).toContain(2);
    expect(executed).toContain(3);
  });
});
