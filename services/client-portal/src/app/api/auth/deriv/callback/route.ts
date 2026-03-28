import { NextRequest, NextResponse } from 'next/server';

const DERIV_CLIENT_ID = process.env.DERIV_APP_ID || '32PRdXKUp42mermjUjv6j';
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || 'https://client-portal-production-e444.up.railway.app/callback/deriv';
const TRADING_ENGINE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

/**
 * Exchange Deriv OAuth authorization code for access token,
 * then save the user's Deriv accounts to our database.
 */
export async function POST(request: NextRequest) {
  try {
    const { code, codeVerifier } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json({ success: false, error: 'Missing code or codeVerifier' }, { status: 400 });
    }

    // Step 1: Exchange authorization code for access token
    const tokenResponse = await fetch('https://auth.deriv.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: DERIV_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: DERIV_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('[Deriv OAuth] Token exchange failed:', err);
      return NextResponse.json({ success: false, error: 'Token exchange failed' }, { status: 400 });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'No access token received' }, { status: 400 });
    }

    // Step 2: Get user's Deriv accounts
    const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Deriv-App-ID': DERIV_CLIENT_ID,
      },
    });

    let accounts: any[] = [];
    if (accountsResponse.ok) {
      const accountsData = await accountsResponse.json();
      accounts = accountsData.data || accountsData.accounts || [];
    }

    // Step 3: Save accounts to our backend (trading engine)
    // Get the user's auth token from the request cookies/headers
    const userToken = request.headers.get('authorization') || request.cookies.get('auth_token')?.value;

    // Save each Deriv account
    const savedAccounts = [];
    for (const account of accounts) {
      try {
        const saveResponse = await fetch(`${TRADING_ENGINE_URL}/api/user/mt5-accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userToken ? { 'Authorization': userToken } : {}),
          },
          body: JSON.stringify({
            label: `Deriv ${account.currency || 'USD'} ${account.is_virtual ? '(Demo)' : '(Real)'}`,
            account_number: account.loginid || account.account_id || 'deriv',
            server: 'deriv',
            broker_type: 'deriv',
            broker_credentials: {
              apiToken: accessToken,
              accountId: account.loginid || account.account_id,
              appId: DERIV_CLIENT_ID,
              currency: account.currency,
              isDemo: account.is_virtual || false,
            },
          }),
        });

        if (saveResponse.ok) {
          savedAccounts.push(account);
        }
      } catch (saveErr) {
        console.error('[Deriv OAuth] Failed to save account:', saveErr);
      }
    }

    // If no accounts endpoint works, save with just the token
    if (savedAccounts.length === 0 && accessToken) {
      try {
        const saveResponse = await fetch(`${TRADING_ENGINE_URL}/api/user/mt5-accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userToken ? { 'Authorization': userToken } : {}),
          },
          body: JSON.stringify({
            label: 'Deriv Account',
            account_number: 'deriv-oauth',
            server: 'deriv',
            broker_type: 'deriv',
            broker_credentials: {
              apiToken: accessToken,
              appId: DERIV_CLIENT_ID,
            },
          }),
        });

        if (saveResponse.ok) {
          savedAccounts.push({ loginid: 'deriv-oauth' });
        }
      } catch {}
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
