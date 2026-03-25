import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const password = body.password;
  const expectedPassword = process.env.ADMIN_PASSWORD || 'providence-admin-2026';

  if (password !== expectedPassword) {
    return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
  }

  const sessionToken = process.env.ADMIN_SESSION_SECRET || 'providencex-admin-2026';

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('admin_session');
  return response;
}
