export const API_BASE = 'https://api.drivethrurpg.com/api/vBeta/';

interface TokenResponse {
  token: string;
  refreshToken: string;
  refreshTokenTTL: number;
}

export async function exchangeKey(apiKey: string): Promise<string> {
  const r = await fetch(`${API_BASE}auth_key?applicationKey=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (r.status === 401) throw new Error('Invalid API key');
  if (!r.ok) throw new Error(`Auth failed: HTTP ${r.status}`);

  const data = (await r.json()) as TokenResponse;
  return data.token;
}
