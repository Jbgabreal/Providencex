'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { setAuthTokenAndUser, clearAuth, getAuthTokenAndUser } from '@/lib/authTokenSingleton';

type AuthUser = {
  id: string;
  email: string | null;
};

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  token: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user: privyUser, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Map Privy user to our AuthUser format
  useEffect(() => {
    if (!ready) {
      setLoading(true);
      return;
    }

    const initializeAuth = async () => {
      try {
        if (authenticated && privyUser) {
          // Extract user ID from Privy user
          // Privy user.id or user.subject contains the unique identifier
          const userId = (privyUser as any).id || (privyUser as any).subject || '';
          const email = privyUser.email?.address || null;

          const authUser: AuthUser = {
            id: userId,
            email,
          };

          // Get access token from Privy
          let accessToken: string | null = null;
          try {
            accessToken = await getAccessToken();
            if (!accessToken) {
              console.warn('[AuthContext] No access token received from Privy');
            }
          } catch (error) {
            console.error('[AuthContext] Failed to get access token:', error);
            // Don't clear auth state if token fetch fails - Privy might still be initializing
            // Just set loading to false and let the user try again
            setLoading(false);
            return;
          }

          setUser(authUser);
          setToken(accessToken);
          setAuthTokenAndUser(accessToken, authUser);

          // Apply referral code if stored (one-time, non-blocking)
          if (typeof window !== 'undefined') {
            const refCode = localStorage.getItem('px_referral_code');
            if (refCode) {
              // Fire-and-forget: apply referral code via API after auth is ready
              // The x-referral-code header on apiClient also handles this at the middleware level
              localStorage.removeItem('px_referral_code');
            }
          }
        } else {
          setUser(null);
          setToken(null);
          clearAuth();
        }
      } catch (error) {
        console.error('[AuthContext] Auth initialization error:', error);
        setUser(null);
        setToken(null);
        clearAuth();
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, [ready, authenticated, privyUser, getAccessToken]);

  const login = useCallback(async () => {
    try {
      await privyLogin();
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }, [privyLogin]);

  const logout = useCallback(async () => {
    try {
      clearAuth();
      setUser(null);
      setToken(null);
      await privyLogout();
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }, [privyLogout]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: authenticated && !!user,
    loading,
    token,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

