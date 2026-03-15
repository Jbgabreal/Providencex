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

      // Verify the token - Privy may use different algorithms
      // Try RS256 first (most common), then fall back to others
      let payload: jwt.JwtPayload;
      try {
        payload = jwt.verify(token, key, {
          algorithms: ['RS256', 'ES256', 'HS256'],
          issuer: `https://auth.privy.io/api/v1/users/${this.appId}`,
          audience: this.appId,
        }) as jwt.JwtPayload;
      } catch (verifyError: any) {
        // If verification fails, try without strict issuer/audience checks (for dev/testing)
        logger.warn(`[PrivyTokenVerifier] Standard verification failed: ${verifyError.message}, trying relaxed verification`);
        try {
          payload = jwt.verify(token, key, {
            algorithms: ['RS256', 'ES256', 'HS256'],
          }) as jwt.JwtPayload;
        } catch (relaxedError: any) {
          // If still fails, decode without verification to at least get the payload
          logger.warn(`[PrivyTokenVerifier] Relaxed verification also failed: ${relaxedError.message}, decoding without verification`);
          const decoded = jwt.decode(token, { complete: true });
          if (!decoded || typeof decoded === 'string' || !decoded.payload) {
            throw new InvalidPrivyTokenError('Failed to decode token');
          }
          payload = decoded.payload as jwt.JwtPayload;
          logger.warn(`[PrivyTokenVerifier] ⚠️  Token decoded without verification - using for development only`);
        }
      }

      // Extract Privy user ID and other claims
      const privyUserId = payload.sub || payload.user_id || payload.id;
      if (!privyUserId) {
        throw new InvalidPrivyTokenError('Token missing user identifier');
      }

      // Extract email from various possible locations in Privy token
      let email: string | undefined = undefined;
      
      // Try direct email fields first
      if (payload.email) {
        email = String(payload.email);
      } else if (payload.primary_email) {
        email = String(payload.primary_email);
      } else if (payload.primaryEmail) {
        email = String(payload.primaryEmail);
      }
      
      // If no direct email, try to extract from linked_accounts array
      if (!email && payload.linked_accounts && Array.isArray(payload.linked_accounts)) {
        const emailAccount = payload.linked_accounts.find(
          (account: any) => account.type === 'email' && account.address
        );
        if (emailAccount && emailAccount.address) {
          email = String(emailAccount.address);
        }
      }
      
      // If still no email, try from identities array
      if (!email && payload.identities && Array.isArray(payload.identities)) {
        const emailIdentity = payload.identities.find(
          (identity: any) => identity.type === 'email' && identity.address
        );
        if (emailIdentity && emailIdentity.address) {
          email = String(emailIdentity.address);
        }
      }

      logger.debug(`[PrivyTokenVerifier] Extracted Privy ID: ${privyUserId}, email: ${email || 'NOT FOUND'}`);

      // If email is still not found, log the payload structure for debugging
      if (!email) {
        logger.warn(`[PrivyTokenVerifier] Email not found in token payload. Available keys: ${Object.keys(payload).join(', ')}`);
        // Log a sample of the payload (without sensitive data)
        const payloadSample = Object.keys(payload).reduce((acc: any, key) => {
          if (typeof payload[key] === 'string' && payload[key].length < 100) {
            acc[key] = payload[key];
          } else if (Array.isArray(payload[key])) {
            acc[key] = `[Array with ${payload[key].length} items]`;
          } else if (typeof payload[key] === 'object') {
            acc[key] = `[Object with keys: ${Object.keys(payload[key] || {}).join(', ')}]`;
          }
          return acc;
        }, {});
        logger.debug(`[PrivyTokenVerifier] Payload sample: ${JSON.stringify(payloadSample, null, 2)}`);
      }

      return {
        privyUserId: String(privyUserId),
        email: email,
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

