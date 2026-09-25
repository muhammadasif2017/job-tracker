import { NextRequest, NextResponse } from 'next/server';

/** Routes reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/register', '/callback'];

/**
 * Route guard run before every matched request. Sends signed-out users to
 * `/login`, non-admins away from `/admin`, and signed-in users away from the
 * login and register pages. It trusts the `jt_authed` and `jt_role` cookies,
 * which are UI hints only: the API enforces the real checks.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  const isAuthed = req.cookies.has('jt_authed');

  if (!isAuthed && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (req.cookies.get('jt_role')?.value !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }
  if (
    isAuthed &&
    isPublic &&
    pathname !== '/callback' &&
    !pathname.startsWith('/callback/')
  ) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

/**
 * Runs the proxy on every route except static assets and `/monitoring`, the
 * Sentry tunnel (ADR-051). The tunnel must stay reachable signed out: an
 * error on the login page would otherwise be redirected to `/login` and lost.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.svg).*)',
  ],
};
