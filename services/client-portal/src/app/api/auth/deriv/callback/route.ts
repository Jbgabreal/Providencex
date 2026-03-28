import { NextRequest, NextResponse } from 'next/server';

const DERIV_APP_ID = process.env.DERIV_APP_ID || '131586';
const TRADING_ENGINE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

/**
 * Save Deriv accounts received from legacy OAuth callback.
 * The legacy flow returns tokens directly in the URL — no code exchange needed.
 */
export async function POST(request: NextRequest) {
  try {
    const { accounts } = await request.json();

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({ success: false, error: 'No accounts provided' }, { status: 400 });
    }

    // Get the user's auth token from the request
    const userToken = request.headers.get('authorization') || request.cookies.get('auth_token')?.value;

    const savedAccounts = [];
    for (const account of accounts) {
      const { loginid, token, currency } = account;
      if (!loginid || !token) continue;

      const isDemo = loginid.startsWith('VRTC') || loginid.startsWith('VR');

      try {
        const saveResponse = await fetch(`${TRADING_ENGINE_URL}/api/user/mt5-accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userToken ? { 'Authorization': userToken } : {}),
          },
          body: JSON.stringify({
            label: `Deriv ${currency || 'USD'} ${isDemo ? '(Demo)' : '(Real)'}`,
            account_number: loginid,
            server: 'deriv',
            broker_type: 'deriv',
            broker_credentials: {
              apiToken: token,
              accountId: loginid,
              appId: DERIV_APP_ID,
              currency: currency || 'USD',
              isDemo,
            },
          }),
        });

        if (saveResponse.ok) {
          savedAccounts.push({ loginid, currency, isDemo });
        } else {
          const err = await saveResponse.text();
          console.error(`[Deriv OAuth] Failed to save ${loginid}:`, err);
        }
      } catch (saveErr) {
        console.error(`[Deriv OAuth] Error saving ${loginid}:`, saveErr);
      }
    }

    return NextResponse.json({
      success: true,
      accounts: savedAccounts,
      accountCount: savedAccounts.length,
    });
  } catch (error) {
    console.error('[Deriv OAuth] Callback error:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
