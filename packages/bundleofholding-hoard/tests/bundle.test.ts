import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchBundlePage } from '../src/bundle.js';

function mockResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status < 400,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Realistic BoH structure: zip link with sub-UL of individual files
const BUNDLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <section id="bundle"><h2 class="title">The Fantasy Bundle</h2></section>
  <section class="description">
    <h4>Starter Collection</h4>
    <ul>
      <li>
        <a download="StarterCollection.zip" href="/download/zipfile/key/abc/type/basic"
           data-hash-md5="zzzzzzzzzzzzz">Entire Starter Collection in one .ZIP archive</a>
        which contains these files:
        <ul>
          <li><a download="file1.pdf" href="/download/file/key/abc/file_id/1"
                 data-hash-md5="aabbcc112233">file1.pdf</a></li>
          <li><a download="file2.epub" href="/download/file/key/abc/file_id/2"
                 data-hash-md5="ddeeff445566">file2.epub</a></li>
        </ul>
      </li>
    </ul>
  </section>
</body>
</html>
`;

// Page that also has product cards at the bottom — files should be deduplicated
const BUNDLE_HTML_WITH_CARDS = `
<!DOCTYPE html>
<html>
<body>
  <section id="bundle"><h2 class="title">Dedup Bundle</h2></section>
  <section class="description">
    <ul>
      <li>
        <a href="/download/zipfile/key/abc/type/basic">Entire Collection</a>
        <ul>
          <li><a download="file1.pdf" href="/download/file/key/abc/file_id/1"
                 data-hash-md5="aabbcc112233">file1.pdf</a></li>
        </ul>
      </li>
    </ul>
  </section>
  <div class="dl-link">
    <span class="download">
      <a download="file1.pdf" href="/download/file/key/abc/file_id/1"
         data-hash-md5="aabbcc112233">file1.pdf</a>
    </span>
  </div>
</body>
</html>
`;

// A file anchor with no download attribute — falls back to text content
const BUNDLE_HTML_NO_DOWNLOAD_ATTR = `
<!DOCTYPE html>
<html>
<body>
  <section id="bundle"><h2 class="title">Minimal Bundle</h2></section>
  <ul>
    <li>
      <a href="/download/zipfile/key/xyz/type/basic">Entire Collection</a>
      <ul>
        <li><a href="/download/file/key/xyz/file_id/9">book.pdf</a></li>
      </ul>
    </li>
  </ul>
</body>
</html>
`;

// No title element — should fall back to the key
const BUNDLE_HTML_NO_TITLE = `
<!DOCTYPE html>
<html>
<body>
  <ul>
    <li>
      <a href="/download/zipfile/key/nk/type/basic">Entire Collection</a>
      <ul>
        <li><a download="f.pdf" href="/download/file/key/nk/file_id/1" data-hash-md5="000">File</a></li>
      </ul>
    </li>
  </ul>
</body>
</html>
`;

// Login redirect detection
const LOGIN_REDIRECT_HTML = `
<!DOCTYPE html>
<html>
<body>
  <form action="/user/login">
    <input name="email" />
  </form>
</body>
</html>
`;

describe('fetchBundlePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses title and files from a bundle page', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML));

    const page = await fetchBundlePage('the-fantasy-bundle');
    expect(page.title).toBe('The Fantasy Bundle');
    expect(page.files).toHaveLength(2);
    expect(page.files[0]).toEqual({
      filename: 'file1.pdf',
      url: 'https://bundleofholding.com/download/file/key/abc/file_id/1',
      md5: 'aabbcc112233',
    });
    expect(page.files[1]).toEqual({
      filename: 'file2.epub',
      url: 'https://bundleofholding.com/download/file/key/abc/file_id/2',
      md5: 'ddeeff445566',
    });
  });

  it('does not include the bundle zip link itself', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML));
    const page = await fetchBundlePage('the-fantasy-bundle');
    expect(page.files.every((f) => !f.url.includes('/download/zipfile/'))).toBe(true);
  });

  it('deduplicates files that appear in both sub-UL and product cards', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML_WITH_CARDS));
    const page = await fetchBundlePage('dedup-bundle');
    expect(page.files).toHaveLength(1);
    expect(page.files[0].filename).toBe('file1.pdf');
  });

  it('falls back to anchor text when download attribute is absent', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML_NO_DOWNLOAD_ATTR));

    const page = await fetchBundlePage('minimal-bundle');
    expect(page.files[0].filename).toBe('book.pdf');
  });

  it('falls back to key when title element is absent', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML_NO_TITLE));

    const page = await fetchBundlePage('my-special-key');
    expect(page.title).toBe('my-special-key');
  });

  it('sends cookie header when provided', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML));

    await fetchBundlePage('key-abc', 'session=tok');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/key-abc'),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=tok' }),
      }),
    );
  });

  it('does not send cookie header when not provided', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML));

    await fetchBundlePage('key-abc');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers).not.toHaveProperty('Cookie');
  });

  it('URL-encodes the key in the request URL', async () => {
    fetchMock.mockResolvedValue(mockResponse(BUNDLE_HTML));

    await fetchBundlePage('key with spaces');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('key%20with%20spaces');
  });

  it('throws when response is not ok', async () => {
    fetchMock.mockResolvedValue(mockResponse('Not Found', 404));

    await expect(fetchBundlePage('bad-key')).rejects.toThrow('HTTP 404');
  });

  it('throws authentication error when page redirects to login form', async () => {
    fetchMock.mockResolvedValue(mockResponse(LOGIN_REDIRECT_HTML));

    await expect(fetchBundlePage('protected-key')).rejects.toThrow(/requires authentication/);
  });

  it('returns empty files array when no download links exist', async () => {
    const emptyHtml = `
      <html><body>
        <section id="bundle"><h2 class="title">Empty Bundle</h2></section>
      </body></html>
    `;
    fetchMock.mockResolvedValue(mockResponse(emptyHtml));

    const page = await fetchBundlePage('empty-bundle');
    expect(page.title).toBe('Empty Bundle');
    expect(page.files).toEqual([]);
  });
});
