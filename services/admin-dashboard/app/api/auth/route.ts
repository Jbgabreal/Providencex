import { NextRequest, NextResponse } from 'next/server';

function setSessionCookie(response: NextResponse) {
  const sessionToken = process.env.ADMIN_SESSION_SECRET || 'providencex-admin-2026';
  response.cookies.set('admin_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, recoveryCode, newPassword } = body;

  // Recovery code flow: verify code and optionally set new password
  if (recoveryCode) {
    const expectedCode = process.env.ADMIN_RECOVERY_CODE;
    if (!expectedCode) {
      return NextResponse.json({ success: false, error: 'Recovery not configured. Set ADMIN_RECOVERY_CODE env var on Railway.' }, { status: 400 });
    }
    if (recoveryCode !== expectedCode) {
      return NextResponse.json({ success: false, error: 'Invalid recovery code' }, { status: 401 });
    }

    // Valid recovery code — log them in
    const response = NextResponse.json({
      success: true,
      message: newPassword
        ? 'Logged in. Note: To permanently change the password, update ADMIN_PASSWORD on Railway.'
        : 'Logged in via recovery code.',
    });
    setSessionCookie(response);
    return response;
  }

  // Normal password flow
  const expectedPassword = process.env.ADMIN_PASSWORD || 'providence-admin-2026';
  if (password !== expectedPassword) {
    return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  setSessionCookie(response);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('admin_session');
  return response;
}
