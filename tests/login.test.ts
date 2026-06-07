import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loginWeb } from '../src/login.js';

function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string | string[]> = {},
) {
  const headerMap = new Map<string, string>();
  const setCookieList: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'set-cookie') {
      if (Array.isArray(v)) {
        for (const c of v) setCookieList.push(c);
      } else {
        setCookieList.push(v as string);
      }
    } else {
      headerMap.set(k.toLowerCase(), Array.isArray(v) ? v[0] : v);
    }
  }

  return {
    status,
    ok: status < 400,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      // Simulate getSetCookie() as used in loginWeb
      getSetCookie: () => setCookieList,
    },
  };
}

describe('loginWeb', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns cookie string on successful 302 redirect', async () => {
    fetchMock.mockResolvedValue(
      mockResponse('', 302, {
        'set-cookie': ['session_id=abc123; Path=/; HttpOnly', 'user=xyz; Path=/'],
      }),
    );

    const cookie = await loginWeb('user@example.com', 'secret');
    expect(cookie).toBe('session_id=abc123; user=xyz');
  });

  it('returns cookie string on 303 redirect', async () => {
    fetchMock.mockResolvedValue(mockResponse('', 303, { 'set-cookie': ['sid=tok; Path=/'] }));
    const cookie = await loginWeb('user@example.com', 'secret');
    expect(cookie).toBe('sid=tok');
  });

  it('throws on 403 (bad credentials)', async () => {
    fetchMock.mockResolvedValue(mockResponse('Forbidden', 403, {}));
    await expect(loginWeb('bad@example.com', 'wrong')).rejects.toThrow(
      'Login failed: invalid email or password',
    );
  });

  it('throws on 401 (bad credentials)', async () => {
    fetchMock.mockResolvedValue(mockResponse('Unauthorized', 401, {}));
    await expect(loginWeb('bad@example.com', 'wrong')).rejects.toThrow(
      'Login failed: invalid email or password',
    );
  });

  it('throws when redirect has no Set-Cookie header', async () => {
    fetchMock.mockResolvedValue(mockResponse('', 302, {}));
    await expect(loginWeb('user@example.com', 'secret')).rejects.toThrow(
      'Login failed: no session cookie returned',
    );
  });

  it('throws when response is neither redirect nor auth error', async () => {
    fetchMock.mockResolvedValue(mockResponse('Internal Server Error', 500, {}));
    await expect(loginWeb('user@example.com', 'secret')).rejects.toThrow(
      'Login failed: expected redirect, got HTTP 500',
    );
  });

  it('sends credentials as form-encoded body', async () => {
    fetchMock.mockResolvedValue(mockResponse('', 302, { 'set-cookie': ['s=1'] }));
    await loginWeb('me@test.com', 'p@ssword');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/user/login');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(opts.body).toContain('users_email=me%40test.com');
    expect(opts.body).toContain('password=p%40ssword');
    expect(opts.redirect).toBe('manual');
  });

  it('falls back to get("set-cookie") when getSetCookie is absent', async () => {
    const resp = mockResponse('', 302, {});
    // Remove getSetCookie to exercise the fallback branch
    const respWithout = {
      ...resp,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'set-cookie' ? 'fallback=1; Path=/' : null),
      },
    };
    fetchMock.mockResolvedValue(respWithout);
    const cookie = await loginWeb('user@example.com', 'secret');
    expect(cookie).toBe('fallback=1');
  });
});
