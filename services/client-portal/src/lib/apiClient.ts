/**
 * API Client
 * 
 * Centralized Axios instance with auth interceptors
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { env } from '@/config/env';
import { getAuthTokenAndUser, clearAuth } from './authTokenSingleton';

export const apiClient = axios.create({
  baseURL: env.backendBaseUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Attach auth token and dev headers
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { token, user } = getAuthTokenAndUser();

    // Attach Authorization header
    if (token) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // Attach user email header (backend needs it for user creation)
    // Privy access tokens don't contain email, so we send it from the frontend
    if (user?.email) {
      config.headers = config.headers || {};
      config.headers['x-user-email'] = user.email;
    }

    // In dev mode, attach user ID header for compatibility (fallback if no token)
    if (env.devMode && user?.id) {
      config.headers = config.headers || {};
      config.headers['x-user-id'] = user.id;
      config.headers['x-user-role'] = 'user';
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: Handle 401 unauthorized
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Clear auth state on unauthorized
      // Don't redirect here - let AuthGuard handle it to prevent loops
      clearAuth();
    }
    
    return Promise.reject(error);
  }
);

// Type-safe API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

