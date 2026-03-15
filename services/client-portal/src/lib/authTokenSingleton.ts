/**
 * Auth Token Singleton
 * 
 * Module-level storage for auth token and user info
 * Used by API client to attach auth headers
 */

type AuthUser = {
  id: string;
  email: string | null;
};

let currentToken: string | null = null;
let currentUser: AuthUser | null = null;

export function setAuthTokenAndUser(token: string | null, user: AuthUser | null): void {
  currentToken = token;
  currentUser = user;
}

export function getAuthTokenAndUser(): { token: string | null; user: AuthUser | null } {
  return {
    token: currentToken,
    user: currentUser,
  };
}

export function clearAuth(): void {
  currentToken = null;
  currentUser = null;
}

