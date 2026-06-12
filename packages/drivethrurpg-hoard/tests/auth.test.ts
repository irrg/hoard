import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { exchangeKey, API_BASE } from '../src/auth.js';

function mockResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => body,
  } as unknown as Response;
}

describe('exchangeKey', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the token on success', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ token: 'bearer-abc', refreshToken: 'ref-xyz', refreshTokenTTL: 3600 }),
    );
    await expect(exchangeKey('my-api-key')).resolves.toBe('bearer-abc');
  });

  it('POSTs to the auth endpoint with the api key in the query string', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ token: 't', refreshToken: 'r', refreshTokenTTL: 0 }),
    );
    await exchangeKey('test-key');
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}auth_key?applicationKey=test-key`);
    expect(opts.method).toBe('POST');
  });

  it('sends Content-Type and Accept headers', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ token: 't', refreshToken: 'r', refreshTokenTTL: 0 }),
    );
    await exchangeKey('k');
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
  });

  it('URL-encodes the api key', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ token: 't', refreshToken: 'r', refreshTokenTTL: 0 }),
    );
    await exchangeKey('key with spaces & symbols');
    const [url] = fetchMock.mock.calls[0] as [string];
    // encodeURIComponent uses %20 for spaces and %26 for &
    expect(url).toContain('applicationKey=key%20with%20spaces%20%26%20symbols');
  });

  it('throws "Invalid API key" on 401', async () => {
    fetchMock.mockResolvedValue({ status: 401, ok: false, json: async () => ({}) });
    await expect(exchangeKey('bad-key')).rejects.toThrow('Invalid API key');
  });

  it('throws with status on non-200 non-401', async () => {
    fetchMock.mockResolvedValue({ status: 503, ok: false, json: async () => ({}) });
    await expect(exchangeKey('k')).rejects.toThrow('Auth failed: HTTP 503');
  });

  it('throws when JSON is malformed', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await expect(exchangeKey('k')).rejects.toThrow();
  });
});
