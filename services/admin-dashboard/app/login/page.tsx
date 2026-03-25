'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(redirect);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryCode }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || 'Recovery successful');
        setTimeout(() => {
          router.push(redirect);
          router.refresh();
        }, 1000);
      } else {
        setError(data.error || 'Invalid recovery code');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  if (showRecovery) {
    return (
      <div>
        <form onSubmit={handleRecovery}>
          <input
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="Enter recovery code"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900"
            autoFocus
          />

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {message && <p className="mt-2 text-sm text-green-600">{message}</p>}

          <button
            type="submit"
            disabled={loading || !recoveryCode}
            className="mt-4 w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying...' : 'Verify Recovery Code'}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          The recovery code is the <code className="bg-gray-100 px-1 rounded">ADMIN_RECOVERY_CODE</code> env var set on Railway.
        </p>

        <button
          onClick={() => { setShowRecovery(false); setError(''); setMessage(''); }}
          className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={handleLogin}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900"
          autoFocus
        />

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <button
        onClick={() => { setShowRecovery(true); setError(''); }}
        className="mt-4 w-full text-sm text-blue-500 hover:text-blue-700"
      >
        Forgot password?
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">ProvidenceX Admin</h1>
        <p className="text-sm text-gray-500 text-center mb-6">Enter the admin password to continue</p>
        <Suspense fallback={<div className="text-center text-gray-400">Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
