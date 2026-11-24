'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, accessCookie, refreshCookie, type Tokens } from '@/lib/session';

export type LoginState = { error: string | null; email: string };

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Enter your email and password', email };
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'The API is not reachable. Is it running?', email };
  }
  if (response.status === 429) {
    return { error: 'Too many attempts. Wait a minute and try again.', email };
  }
  if (response.status === 401 || response.status === 400) {
    return { error: 'Wrong email or password', email };
  }
  if (!response.ok) {
    return { error: `Sign-in failed (${response.status})`, email };
  }

  const tokens = (await response.json()) as Tokens;
  const jar = await cookies();
  jar.set(accessCookie(tokens.accessToken));
  jar.set(refreshCookie(tokens.refreshToken));
  redirect('/');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Revoke the refresh token on the server too, not only in this browser.
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/login');
}
