'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/apiClient';
import { Target, Radio, TrendingUp, BarChart3, Shield, DollarSign, Users, Zap } from 'lucide-react';

function LoginContent() {
  const { isAuthenticated, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasRedirected = useRef(false);

  // Capture referral code from URL (?ref=CODE) and store in localStorage
  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) {
      localStorage.setItem('px_referral_code', refCode.trim().toUpperCase());
    }
  }, [searchParams]);

  // Smart redirect after authentication
  useEffect(() => {
    if (!loading && isAuthenticated && !hasRedirected.current) {
      hasRedirected.current = true;

      // Check user profile to auto-detect type
      apiClient
        .get('/api/auth/me')
        .then((res: any) => {
          const user = res.data?.user;
          if (user?.mentorProfile) {
            // Returning mentor → mentor dashboard
            router.replace('/mentor-dashboard');
          } else {
            // Check stored intent for new users
            const intent = localStorage.getItem('px_login_intent');
            if (intent === 'mentor') {
              router.replace('/mentor-dashboard');
            } else {
              router.replace('/dashboard');
            }
          }
        })
        .catch(() => {
          // Fallback: use stored intent or default to dashboard
          const intent = localStorage.getItem('px_login_intent');
          router.replace(intent === 'mentor' ? '/mentor-dashboard' : '/dashboard');
        });
    }
  }, [loading, isAuthenticated, router]);

  const handleLogin = (intent: 'trader' | 'mentor') => {
    localStorage.setItem('px_login_intent', intent);
    login();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-2xl w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome to ProvidenceX
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Choose how you want to get started
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          {/* Trader Card */}
          <button
            onClick={() => handleLogin('trader')}
            className="group text-left p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-green-500 hover:shadow-lg transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                <Target className="h-6 w-6 text-green-700" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">I&apos;m a Trader</h2>
                <p className="text-xs text-gray-500">Trade, copy signals, manage accounts</p>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span>Automated MT5 strategy execution</span>
              </li>
              <li className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span>Real-time PnL &amp; equity curves</span>
              </li>
              <li className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span>Risk-tiered strategies</span>
              </li>
              <li className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span>Copy top mentor signals</span>
              </li>
            </ul>
            <div className="mt-5 w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium text-center group-hover:bg-green-700 transition-colors">
              Sign in as Trader
            </div>
          </button>

          {/* Mentor Card */}
          <button
            onClick={() => handleLogin('mentor')}
            className="group text-left p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                <Radio className="h-6 w-6 text-blue-700" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">I&apos;m a Mentor</h2>
                <p className="text-xs text-gray-500">Share signals, grow followers, earn</p>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                <span>Publish trading signals</span>
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                <span>Platform-verified analytics</span>
              </li>
              <li className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                <span>Build your follower base</span>
              </li>
              <li className="flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                <span>Subscription plans &amp; earnings</span>
              </li>
            </ul>
            <div className="mt-5 w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium text-center group-hover:bg-blue-700 transition-colors">
              Sign in as Mentor
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900" /></div>}>
      <LoginContent />
    </Suspense>
  );
}
