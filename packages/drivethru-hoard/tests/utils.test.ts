import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { normalizePathPart, fetchWithRetry, NoDownloadError } from '../src/utils.js';

describe('NoDownloadError', () => {
  it('is an Error with the right name', () => {
    const e = new NoDownloadError('oops');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NoDownloadError');
    expect(e.message).toBe('oops');
  });
});

describe('normalizePathPart — default mode', () => {
  it('leaves clean names unchanged', () => {
    expect(normalizePathPart('Pathfinder', false)).toBe('Pathfinder');
  });

  it('replaces filesystem-unsafe characters with " - "', () => {
    expect(normalizePathPart('Game: The Beginning', false)).toBe('Game - The Beginning');
    expect(normalizePathPart('foo/bar', false)).toBe('foo - bar');
    expect(normalizePathPart('foo\\bar', false)).toBe('foo - bar');
    expect(normalizePathPart('pipe|name', false)).toBe('pipe - name');
    expect(normalizePathPart('"quoted"', false)).toBe('quoted');
    expect(normalizePathPart('<angled>', false)).toBe('angled');
    expect(normalizePathPart('star*name', false)).toBe('star - name');
    expect(normalizePathPart('ques?tion', false)).toBe('ques - tion');
  });

  it('strips leading and trailing " - " separators', () => {
    expect(normalizePathPart(':Leading colon', false)).toBe('Leading colon');
    expect(normalizePathPart('Trailing colon:', false)).toBe('Trailing colon');
  });

  it('replaces each unsafe char independently (double colon becomes double dash)', () => {
    // each ':' is replaced with ' - ', yielding 'a -  - b'; the regex collapses adjacent
    // ' - \s+- ' only when they share the same whitespace token, so 'a - - b' is the result
    expect(normalizePathPart('a::b', false)).toBe('a - - b');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizePathPart('too   many   spaces', false)).toBe('too many spaces');
  });

  it('html-unescapes entities before processing', () => {
    expect(normalizePathPart('D&amp;D', false)).toBe('D&D');
    expect(normalizePathPart('&lt;Tag&gt;', false)).toBe('Tag');
    expect(normalizePathPart('say &quot;hello&quot;', false)).toBe('say - hello');
    expect(normalizePathPart('it&#39;s', false)).toBe("it's");
    expect(normalizePathPart('hello&nbsp;world', false)).toBe('hello world');
  });
});

describe('normalizePathPart — compat mode', () => {
  it('replaces non-alphanumeric/period/space with underscore', () => {
    expect(normalizePathPart('Game: One', true)).toBe('Game_ One');
    expect(normalizePathPart('foo/bar', true)).toBe('foo_bar');
    expect(normalizePathPart('cost $5', true)).toBe('cost _5');
  });

  it('preserves periods and spaces', () => {
    expect(normalizePathPart('file.pdf', true)).toBe('file.pdf');
    expect(normalizePathPart('my file', true)).toBe('my file');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizePathPart('too  many', true)).toBe('too many');
  });

  it('does not html-unescape in compat mode', () => {
    // ampersand is not alphanumeric so it gets replaced
    expect(normalizePathPart('D&amp;D', true)).toBe('D_amp_D');
  });
});

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

  it('returns the response immediately when status is not 429', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true });
    const r = await fetchWithRetry('https://api.example.com/');
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and returns the success response', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200, ok: true });
    const p = fetchWithRetry('https://api.example.com/', undefined, 3);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects the Retry-After header', async () => {
    const waits: number[] = [];
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => '7' } })
      .mockResolvedValueOnce({ status: 200, ok: true });
    vi.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      waits.push(ms as number);
      (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    await fetchWithRetry('https://api.example.com/', undefined, 3);
    expect(waits[0]).toBe(7000);
  });

  it('returns the last 429 response after exhausting retries', async () => {
    fetchMock.mockResolvedValue({ status: 429, headers: { get: () => null } });
    const p = fetchWithRetry('https://api.example.com/', undefined, 2);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.status).toBe(429);
    // attempt 0, 1, 2 → 3 calls total (retries=2 means stop at attempt >= 2)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('calls fetch with the supplied URL and options', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true });
    await fetchWithRetry('https://api.example.com/foo', { headers: { Authorization: 'tok' } });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/foo', {
      headers: { Authorization: 'tok' },
    });
  });

  it('calls the logger when rate-limited', async () => {
    const logger = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200, ok: true });
    const p = fetchWithRetry('https://api.example.com/', undefined, 3, logger);
    await vi.runAllTimersAsync();
    await p;
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
  });

  it('doubles the delay on successive retries when no Retry-After header', async () => {
    const waits: number[] = [];
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 429, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200, ok: true });
    vi.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      waits.push(ms as number);
      (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    await fetchWithRetry('https://api.example.com/', undefined, 3);
    expect(waits[1]).toBe(waits[0]! * 2);
  });
});
