import { NextRequest, NextResponse } from 'next/server';
import { canAccessManagerPage } from './server/auth/manager-access';

// Check the live server session even on client navigation/RSC requests. This also
// guards /m/import without changing the import worker's files.
export async function middleware(request: NextRequest) {
  try {
    const response = await fetch(new URL('/api/me', request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (!response.ok) return NextResponse.redirect(new URL('/login', request.url));
    const { data: user } = await response.json();
    if (!canAccessManagerPage(user.role, request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL(user.role === 'DRIVER' ? '/d' : '/m', request.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    '/m/statements/:path*',
    '/m/payments/:path*',
    '/m/import/:path*',
    '/m/master/:path*',
    '/m/users/:path*',
  ],
};
