import { parse } from 'node-html-parser';

import { BASE_URL } from './login.js';

export interface BundleRef {
  name: string;
  key: string;
}

export async function fetchCabinet(cookie: string): Promise<BundleRef[]> {
  const r = await fetch(`${BASE_URL}/download/list`, {
    headers: {
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0',
    },
  });

  if (!r.ok) throw new Error(`Failed to fetch Wizard's Cabinet: HTTP ${r.status}`);

  const html = await r.text();
  const root = parse(html);

  const anchors = root.querySelectorAll('table#bundle-list-table tbody tr td:first-child a');

  return anchors
    .map((a) => {
      const href = a.getAttribute('href') ?? '';
      const key = href.split('/').pop() ?? '';
      const name = a.text.trim();
      return { name, key };
    })
    .filter((b) => b.key.length > 0);
}
