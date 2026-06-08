import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchCabinet } from '../src/cabinet.js';

function mockResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Minimal Wizard's Cabinet page with two bundle rows
const CABINET_HTML = `
<!DOCTYPE html>
<html>
<body>
  <table id="bundle-list-table">
    <thead><tr><th>Bundle</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/download/list/key/abc-123">Starter Bundle</a></td>
      </tr>
      <tr>
        <td><a href="/download/list/key/def-456">Advanced Bundle</a></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

// Page where the anchor href ends with a slash (key would be empty → filtered out)
const CABINET_HTML_TRAILING_SLASH = `
<!DOCTYPE html>
<html>
<body>
  <table id="bundle-list-table">
    <thead><tr><th>Bundle</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/download/list/key/">Bad Row</a></td>
      </tr>
      <tr>
        <td><a href="/download/list/key/good-key">Good Bundle</a></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const CABINET_HTML_EMPTY = `
<!DOCTYPE html>
<html>
<body>
  <table id="bundle-list-table">
    <thead><tr><th>Bundle</th></tr></thead>
    <tbody>
    </tbody>
  </table>
</body>
</html>
`;

describe('fetchCabinet', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses bundle refs from a cabinet page', async () => {
    fetchMock.mockResolvedValue(mockResponse(CABINET_HTML));

    const refs = await fetchCabinet('session=tok');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ name: 'Starter Bundle', key: 'abc-123' });
    expect(refs[1]).toEqual({ name: 'Advanced Bundle', key: 'def-456' });
  });

  it('sends the cookie header', async () => {
    fetchMock.mockResolvedValue(mockResponse(CABINET_HTML));

    await fetchCabinet('session=secret');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/download/list'),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=secret' }),
      }),
    );
  });

  it('filters out rows with empty keys', async () => {
    fetchMock.mockResolvedValue(mockResponse(CABINET_HTML_TRAILING_SLASH));

    const refs = await fetchCabinet('session=tok');
    expect(refs).toHaveLength(1);
    expect(refs[0].key).toBe('good-key');
  });

  it('returns empty array when table has no rows', async () => {
    fetchMock.mockResolvedValue(mockResponse(CABINET_HTML_EMPTY));

    const refs = await fetchCabinet('session=tok');
    expect(refs).toEqual([]);
  });

  it('throws on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue(mockResponse('Unauthorized', 401));

    await expect(fetchCabinet('session=bad')).rejects.toThrow("Failed to fetch Wizard's Cabinet");
    await expect(fetchCabinet('session=bad')).rejects.toThrow('HTTP 401');
  });

  it('throws on 500 server error', async () => {
    fetchMock.mockResolvedValue(mockResponse('Internal Server Error', 500));

    await expect(fetchCabinet('session=tok')).rejects.toThrow('HTTP 500');
  });
});
