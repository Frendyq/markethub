// Cookie helpers shared by proxy.ts, server actions and the API client.
// Tokens live in httpOnly cookies: page scripts can't read them, so an XSS can't steal them.

export const ACCESS_COOKIE = 'mh_access';
export const REFRESH_COOKIE = 'mh_refresh';

export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export const accessCookie = (value: string) => ({ ...base, name: ACCESS_COOKIE, value, maxAge: 15 * 60 });
export const refreshCookie = (value: string) => ({ ...base, name: REFRESH_COOKIE, value, maxAge: 7 * 24 * 3600 });

/** Seconds until the JWT expires (no signature check: the API verifies it, we only decide when to refresh). */
export function secondsLeft(token: string | undefined): number {
  if (!token) {
    return 0;
  }
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/** Calls the API refresh endpoint. Returns null when the refresh token is no longer valid. */
export async function refreshTokens(refreshToken: string): Promise<Tokens | null> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  return response.ok ? ((await response.json()) as Tokens) : null;
}
