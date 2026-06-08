import { parse } from 'node-html-parser';

import { BASE_URL } from './login.js';

export interface DownloadFile {
  filename: string;
  url: string;
  md5: string;
}

export interface BundlePage {
  title: string;
  files: DownloadFile[];
}

export async function fetchBundlePage(key: string, cookie?: string): Promise<BundlePage> {
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' };
  if (cookie) headers['Cookie'] = cookie;

  const r = await fetch(`${BASE_URL}/download/list/key/${encodeURIComponent(key)}`, { headers });
  if (!r.ok) throw new Error(`Failed to fetch bundle page for key ${key}: HTTP ${r.status}`);

  const html = await r.text();
  const root = parse(html);

  // Detect redirect to login page
  if (root.querySelector("form[action='/user/login']")) {
    throw new Error(
      `Bundle page for key "${key}" requires authentication. Provide -e/--email and -p/--password.`,
    );
  }

  const titleEl = root.querySelector('section#bundle h2.title');
  const title = titleEl?.text.trim() ?? key;

  const seen = new Set<string>();
  const files: DownloadFile[] = [];
  for (const a of root.querySelectorAll('a[href*="/download/file/"]')) {
    const href = a.getAttribute('href') ?? '';
    if (seen.has(href)) continue;
    seen.add(href);
    files.push({
      filename: a.getAttribute('download') ?? a.text.trim(),
      url: BASE_URL + href,
      md5: (a.getAttribute('data-hash-md5') ?? '').toLowerCase(),
    });
  }

  return { title, files };
}
