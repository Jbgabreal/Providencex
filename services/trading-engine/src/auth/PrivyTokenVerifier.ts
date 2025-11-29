import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { Logger } from '@providencex/shared-utils';
import { PrivyIdentity } from './types';

const logger = new Logger('PrivyTokenVerifier');

export class InvalidPrivyTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPrivyTokenError';
  }
}

export class PrivyTokenVerifier {
  private jwksClient: jwksClient.JwksClient | null = null;

  constructor(
    private readonly appId: string | null,
    private readonly jwksUrl: string | null
  ) {
    if (jwksUrl) {
      this.jwksClient = jwksClient({
        jwksUri: jwksUrl,
        cache: true,
        cacheMaxAge: 86400000, // 24 hours
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      });
    }
  }

  async verify(token: string): Promise<PrivyIdentity> {
    if (!this.appId || !this.jwksUrl || !this.jwksClient) {
      throw new InvalidPrivyTokenError('Privy configuration missing');
    }

    try {
      // Decode without verification first to get the header
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded || typeof decoded === 'string' || !decoded.header) {
        throw new InvalidPrivyTokenError('Invalid token format');
      }

      // Get the key ID from the token header
      const kid = decoded.header.kid;
      if (!kid) {
        throw new InvalidPrivyTokenError('Token missing key ID');
      }

      // Get the signing key from JWKS
      const key = await this.getSigningKey(kid);

      // Verify the token
      const payload = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: `https://auth.privy.io/api/v1/users/${this.appId}`,
        audience: this.appId,
      }) as jwt.JwtPayload;

      // Extract Privy user ID and other claims
      const privyUserId = payload.sub || payload.user_id || payload.id;
      if (!privyUserId) {
        throw new InvalidPrivyTokenError('Token missing user identifier');
      }

      return {
        privyUserId: String(privyUserId),
        email: payload.email || payload.primary_email || undefined,
        wallets: payload.wallets || undefined,
        ...payload,
      };
    } catch (error: any) {
      if (error instanceof InvalidPrivyTokenError) {
        throw error;
      }

      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        logger.warn(`[PrivyTokenVerifier] Token verification failed: ${error.message}`);
        throw new InvalidPrivyTokenError(`Token verification failed: ${error.message}`);
      }

      logger.error('[PrivyTokenVerifier] Unexpected error during token verification', error);
      throw new InvalidPrivyTokenError('Token verification failed');
    }
  }

  private async getSigningKey(kid: string): Promise<string> {
    if (!this.jwksClient) {
      throw new InvalidPrivyTokenError('JWKS client not initialized');
    }

    try {
      const key = await this.jwksClient.getSigningKey(kid);
      return key.getPublicKey();
    } catch (error: any) {
      logger.error(`[PrivyTokenVerifier] Failed to get signing key for kid=${kid}`, error);
      throw new InvalidPrivyTokenError('Failed to retrieve signing key');
    }
  }
}

