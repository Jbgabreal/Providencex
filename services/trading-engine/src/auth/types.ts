export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  email: string | null;
  external_auth_id: string | null;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export interface PrivyIdentity {
  privyUserId: string;
  email?: string;
  wallets?: string[];
  [key: string]: any;
}

