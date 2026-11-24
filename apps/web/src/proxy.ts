import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookie, refreshCookie, refreshTokens, secondsLeft } from './lib/session';

/**
 * Runs before every panel request:
 * - no refresh token -> the user isn't signed in, go to /login;
 * - access token missing or expiring within a minute -> refresh it with the API once, here,
 *   and pass the new token both to the page being rendered and to the browser.
 * Server Components can't set cookies, which is why the refresh happens in the proxy.
 */
export async function proxy(request: NextRequest) {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (secondsLeft(request.cookies.get(ACCESS_COOKIE)?.value) > 60) {
    return NextResponse.next();
  }

  const tokens = await refreshTokens(refresh).catch(() => null);
  // Two requests at the same moment both try to refresh; only one wins. The other one
  // carries on with the old access token, which is still valid for up to a minute.
  if (!tokens && secondsLeft(request.cookies.get(ACCESS_COOKIE)?.value) > 0) {
    return NextResponse.next();
  }
  if (!tokens) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  // The page rendering this request reads cookies from the request, so update it too.
  request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(accessCookie(tokens.accessToken));
  response.cookies.set(refreshCookie(tokens.refreshToken));
  return response;
}

export const config = {
  // Everything except the login page, Next.js internals and static files.
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
