import { describe, expect, it } from 'vitest';
import { accessCookie, refreshCookie, secondsLeft } from './session';

const jwt = (payload: object) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('secondsLeft', () => {
  it('reads the expiry of a JWT', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(secondsLeft(jwt({ exp: now + 600 }))).toBeGreaterThan(590);
    expect(secondsLeft(jwt({ exp: now - 10 }))).toBeLessThan(0);
  });

  it('treats a missing or broken token as expired', () => {
    expect(secondsLeft(undefined)).toBe(0);
    expect(secondsLeft('not-a-jwt')).toBe(0);
    expect(secondsLeft(jwt({}))).toBeLessThan(0);
  });
});

describe('cookies', () => {
  it('are httpOnly, so page scripts cannot read the tokens', () => {
    expect(accessCookie('a')).toMatchObject({ name: 'mh_access', httpOnly: true, sameSite: 'lax', maxAge: 900 });
    expect(refreshCookie('r')).toMatchObject({ name: 'mh_refresh', httpOnly: true, maxAge: 604800 });
  });
});
