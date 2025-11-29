import { Request, Response, NextFunction } from 'express';
import { Logger } from '@providencex/shared-utils';
import { PrivyTokenVerifier, InvalidPrivyTokenError } from '../auth/PrivyTokenVerifier';
import { UserAuthRepository } from '../auth/UserAuthRepository';
import { PrivyIdentity, UserRole } from '../auth/types';
import { TradingEngineConfig } from '../config';

const logger = new Logger('AuthMiddleware');

export function buildAuthMiddleware(config: TradingEngineConfig) {
  const verifier = config.privyAppId && config.privyJwksUrl
    ? new PrivyTokenVerifier(config.privyAppId, config.privyJwksUrl)
    : null;
  const userRepo = new UserAuthRepository(config.databaseUrl);
  const devMode = config.authDevMode;

  async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      // 1) Dev mode override using x-user-id / x-user-role
      if (devMode && req.headers['x-user-id']) {
        const userId = String(req.headers['x-user-id']);
        const roleHeader = (req.headers['x-user-role'] as string | undefined) ?? 'user';
        const role = roleHeader.toLowerCase() === 'admin' ? 'admin' : 'user';

        logger.debug(`[AuthMiddleware] Dev mode: using x-user-id=${userId}, role=${role}`);

        req.auth = {
          userId,
          role,
        };
        return next();
      }

      // 2) Normal Privy token path
      if (!verifier) {
        if (devMode) {
          // In dev mode without Privy config, allow unauthenticated (for testing)
          logger.warn('[AuthMiddleware] No Privy verifier configured and dev mode enabled, allowing unauthenticated request');
          return next();
        }
        return res.status(500).json({
          success: false,
          error: 'Authentication not configured',
        });
      }

      const authHeader = req.headers.authorization;
      const tokenHeader = (req.headers['x-privy-token'] as string | undefined) ?? null;

      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice('Bearer '.length).trim();
      } else if (tokenHeader) {
        token = tokenHeader;
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Missing authentication token',
        });
      }

      const identity = await verifier.verify(token);
      const user = await userRepo.findOrCreateForPrivy(identity);

      req.auth = {
        userId: user.id,
        role: user.role,
        privyUserId: identity.privyUserId,
        identity,
      };

      logger.debug(`[AuthMiddleware] Authenticated user: ${user.id} (Privy: ${identity.privyUserId}), role: ${user.role}`);

      return next();
    } catch (err: any) {
      if (err instanceof InvalidPrivyTokenError) {
        logger.warn(`[AuthMiddleware] Invalid Privy token: ${err.message}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid authentication token',
        });
      }

      logger.error('[AuthMiddleware] Unexpected error', err);
      return res.status(500).json({
        success: false,
        error: 'Authentication error',
      });
    }
  }

  function requireUser(req: Request, res: Response, next: NextFunction) {
    if (!req.auth?.userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return next();
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    // Dev override: if in devMode and x-user-role=admin, allow even without Privy
    if (devMode && req.headers['x-user-role']?.toString().toLowerCase() === 'admin') {
      if (!req.auth) {
        // Ensure we at least have some auth object for logging / consistency
        const userId = (req.headers['x-user-id'] as string) ?? 'dev-admin';
        req.auth = {
          userId,
          role: 'admin',
        };
      } else {
        req.auth.role = 'admin';
      }
      logger.debug('[AuthMiddleware] Dev mode: admin override via x-user-role header');
      return next();
    }

    if (!req.auth?.userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (req.auth.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }
    return next();
  }

  return {
    authMiddleware,
    requireUser,
    requireAdmin,
  };
}

