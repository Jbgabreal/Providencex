import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'admin_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and API routes
  if (pathname === '/login' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get(AUTH_COOKIE)?.value;
  const expectedToken = process.env.ADMIN_SESSION_SECRET || 'providencex-admin-2026';

  if (session === expectedToken) {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
