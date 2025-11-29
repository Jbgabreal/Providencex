import { PrivyIdentity, UserRole } from '../auth/types';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        privyUserId?: string;
        identity?: PrivyIdentity;
      };
    }
  }
}

export {};

