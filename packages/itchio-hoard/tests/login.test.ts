import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loginAPI } from '../src/login.js';

describe('loginAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the API key on success', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, key: { key: 'my-api-key' } }),
    });
    await expect(loginAPI('user', 'pass')).resolves.toBe('my-api-key');
  });

  it('throws on non-200 status', async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      text: async () => 'forbidden',
    });
    await expect(loginAPI('user', 'pass')).rejects.toThrow('LoginAPI failed');
  });

  it('throws when success is false', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ success: false }),
    });
    await expect(loginAPI('user', 'pass')).rejects.toThrow('authentication failed');
  });

  it('throws when success is true but key is absent', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ success: true }),
    });
    await expect(loginAPI('user', 'pass')).rejects.toThrow('authentication failed');
  });

  it('posts to the itch.io login endpoint with correct fields', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, key: { key: 'k' } }),
    });
    await loginAPI('myuser', 'mypass');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.itch.io/login');
    expect(opts.body.toString()).toContain('username=myuser');
    expect(opts.body.toString()).toContain('source=desktop');
  });
});
