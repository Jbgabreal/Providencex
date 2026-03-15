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

  // Log Privy configuration status
  if (verifier) {
    logger.info(`[AuthMiddleware] Privy authentication enabled (App ID: ${config.privyAppId?.substring(0, 10)}...)`);
  } else {
    logger.warn(`[AuthMiddleware] Privy authentication disabled - missing PRIVY_APP_ID or PRIVY_JWKS_URL. Dev mode: ${devMode}`);
  }

  async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      // Get token from headers (check both Authorization and x-privy-token)
      const authHeader = req.headers.authorization;
      const tokenHeader = (req.headers['x-privy-token'] as string | undefined) ?? null;
      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice('Bearer '.length).trim();
      } else if (tokenHeader) {
        token = tokenHeader;
      }

      // 1) Dev mode override using x-user-id / x-user-role (fallback if no token)
      if (devMode && req.headers['x-user-id'] && !token) {
        const privyUserId = String(req.headers['x-user-id']);
        const roleHeader = (req.headers['x-user-role'] as string | undefined) ?? 'user';
        const role = roleHeader.toLowerCase() === 'admin' ? 'admin' : 'user';

        logger.debug(`[AuthMiddleware] Dev mode: received x-user-id=${privyUserId}, role=${role} (no token provided)`);

        // Get email from header (required for user creation when no token)
        const emailHeader = req.headers['x-user-email'] as string | undefined;
        const email = emailHeader ? emailHeader.toLowerCase().trim() : null;

        // Check if it's a Privy ID (either DID format or short format)
        const isPrivyId = privyUserId.startsWith('did:privy:') || 
                         /^[a-z0-9]{20,}$/i.test(privyUserId);

        // If it's a Privy ID, look up the internal user UUID
        let internalUserId: string;
        if (isPrivyId) {
          const user = await userRepo.findByExternalAuthId(privyUserId);
          if (!user) {
            // Email is required for new user creation
            if (!email) {
              logger.error(`[AuthMiddleware] Dev mode: Cannot create user without email. Privy ID: ${privyUserId}`);
              return res.status(400).json({
                success: false,
                error: 'Email is required for user creation. Please provide x-user-email header or use Privy token authentication.',
              });
            }
            
            logger.warn(`[AuthMiddleware] Dev mode: Privy user ${privyUserId} not found in database. Creating user...`);
            const identity: PrivyIdentity = {
              privyUserId,
              email: email,
            };
            const newUser = await userRepo.findOrCreateForPrivy(identity);
            internalUserId = newUser.id;
            logger.info(`[AuthMiddleware] Dev mode: Created user ${internalUserId} for Privy ID ${privyUserId} (email: ${email})`);
          } else {
            internalUserId = user.id;
            logger.debug(`[AuthMiddleware] Dev mode: Mapped Privy ID ${privyUserId} to internal UUID ${internalUserId}`);
          }
        } else {
          // Check if it's a valid UUID format (for backward compatibility)
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(privyUserId)) {
            internalUserId = privyUserId;
            logger.debug(`[AuthMiddleware] Dev mode: Using provided UUID directly: ${internalUserId}`);
          } else {
            // Not a Privy ID and not a UUID - treat as Privy ID anyway and create user
            if (!email) {
              logger.error(`[AuthMiddleware] Dev mode: Cannot create user without email. User ID: ${privyUserId}`);
              return res.status(400).json({
                success: false,
                error: 'Email is required for user creation. Please provide x-user-email header or use Privy token authentication.',
              });
            }
            
            logger.warn(`[AuthMiddleware] Dev mode: x-user-id doesn't match known formats, treating as Privy ID: ${privyUserId}`);
            const identity: PrivyIdentity = {
              privyUserId,
              email: email,
            };
            const newUser = await userRepo.findOrCreateForPrivy(identity);
            internalUserId = newUser.id;
            logger.info(`[AuthMiddleware] Dev mode: Created user ${internalUserId} for Privy ID ${privyUserId} (email: ${email})`);
          }
        }

        req.auth = {
          userId: internalUserId,
          role,
          privyUserId: isPrivyId ? privyUserId : undefined,
        };
        return next();
      }

      // 2) Normal Privy token path (preferred - gets email from token)
      if (!token) {
        if (devMode) {
          // In dev mode without token, allow unauthenticated (for testing)
          logger.warn('[AuthMiddleware] No token provided and dev mode enabled, allowing unauthenticated request');
          return next();
        }
        return res.status(401).json({
          success: false,
          error: 'Missing authentication token',
        });
      }

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

      // Verify Privy token
      logger.debug(`[AuthMiddleware] Verifying Privy token...`);
      const identity = await verifier.verify(token);
      logger.debug(`[AuthMiddleware] Token verified, Privy ID: ${identity.privyUserId}, email from token: ${identity.email || 'none'}`);
      
      // Get email from token OR from x-user-email header (Privy access tokens don't contain email)
      const emailHeader = (req.headers['x-user-email'] as string | undefined)?.toLowerCase()?.trim();
      const email = identity.email || emailHeader;
      
      // Email is required - Privy requires email for authentication
      if (!email) {
        logger.error(`[AuthMiddleware] Privy token missing email. Privy ID: ${identity.privyUserId}, payload keys: ${Object.keys(identity).join(', ')}, x-user-email header: ${emailHeader || 'not provided'}`);
        return res.status(400).json({
          success: false,
          error: 'Email is required. Please ensure your Privy account has an email address.',
        });
      }
      
      // Use email from header if token doesn't have it
      const identityWithEmail: PrivyIdentity = {
        ...identity,
        email: email,
      };
      
      logger.debug(`[AuthMiddleware] Creating/finding user for Privy ID: ${identity.privyUserId}, email: ${email}`);
      const user = await userRepo.findOrCreateForPrivy(identityWithEmail);
      logger.info(`[AuthMiddleware] ✅ User found/created: ${user.id} (Privy: ${identity.privyUserId}), email: ${email}, role: ${user.role}`);

      req.auth = {
        userId: user.id,
        role: user.role,
        privyUserId: identity.privyUserId,
        identity,
      };

      logger.debug(`[AuthMiddleware] Authenticated user: ${user.id} (Privy: ${identity.privyUserId}), email: ${identity.email}, role: ${user.role}`);

      return next();
    } catch (err: any) {
      if (err instanceof InvalidPrivyTokenError) {
        logger.warn(`[AuthMiddleware] Invalid Privy token: ${err.message}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid authentication token',
        });
      }

      logger.error('[AuthMiddleware] Unexpected error during authentication', {
        error: err.message,
        stack: err.stack,
        name: err.name,
      });
      return res.status(500).json({
        success: false,
        error: 'Authentication error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
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

