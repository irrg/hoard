const WARNING =
  'Will print the response text (Please be careful as ' +
  'this may contain personal data or allow others to login to your account):';

export interface WebSession {
  get(url: string): Promise<Response>;
  post(url: string, data: Record<string, string>): Promise<Response>;
}

export async function loginAPI(user: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username: user, password, source: 'desktop' });
  const r = await fetch('https://api.itch.io/login', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (r.status !== 200) {
    console.log(`Error: ${r.status} is not 200`);
    console.log(WARNING);
    console.log(await r.text());
    throw new Error('LoginAPI failed');
  }

  const t = (await r.json()) as { success: boolean; key?: { key: string } };

  if (!t.success || !t.key?.key) {
    console.log('Error: authentication failed');
    console.log(WARNING);
    throw new Error('LoginAPI: authentication failed');
  }

  return t.key.key;
}

export async function loginWeb(user: string, password: string): Promise<WebSession> {
  const cookies: Map<string, string> = new Map();

  function buildCookieHeader(): string {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function storeCookies(response: Response): void {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    for (const part of setCookie.split(',')) {
      const nameVal = part.trim().split(';')[0];
      const eq = nameVal.indexOf('=');
      if (eq !== -1) {
        cookies.set(nameVal.slice(0, eq).trim(), nameVal.slice(eq + 1).trim());
      }
    }
  }

  // GET login page to obtain CSRF token
  const loginPage = await fetch('https://itch.io/login', {
    headers: { Cookie: buildCookieHeader() },
    redirect: 'follow',
  });
  storeCookies(loginPage);

  const html = await loginPage.text();
  const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error('Could not find CSRF token on login page');
  const csrfToken = csrfMatch[1];

  // POST credentials
  const body = new URLSearchParams({ username: user, password, csrf_token: csrfToken });
  const postResp = await fetch('https://itch.io/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: buildCookieHeader(),
    },
    body,
    redirect: 'follow',
  });
  storeCookies(postResp);

  if (postResp.status !== 200) throw new Error('LoginWeb: POST failed');

  const session: WebSession = {
    async get(url: string): Promise<Response> {
      const r = await fetch(url, { headers: { Cookie: buildCookieHeader() } });
      storeCookies(r);
      return r;
    },
    async post(url: string, data: Record<string, string>): Promise<Response> {
      const formBody = new URLSearchParams(data);
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: buildCookieHeader(),
        },
        body: formBody,
      });
      storeCookies(r);
      return r;
    },
  };

  return session;
}
