/**
 * AttributionService — Links referred users to their referrers.
 * Called after user creation when a referral code is present.
 */

import { Logger } from '@providencex/shared-utils';
import { ReferralRepository } from './ReferralRepository';
import { NotificationService } from '../notifications/NotificationService';
import type { ReferralAttribution, AttributionSource } from './types';

const logger = new Logger('AttributionService');

export class AttributionService {
  constructor(private repo: ReferralRepository) {}

  /**
   * Apply a referral code for a newly created user.
   * Returns the attribution if successful, null if blocked/invalid.
   *
   * Anti-abuse:
   * - Prevents self-referral
   * - Prevents double-attribution (user already has a referrer)
   * - Validates referral code exists and is active
   */
  async applyReferralCode(params: {
    referredUserId: string;
    referralCode: string;
    source?: AttributionSource;
  }): Promise<ReferralAttribution | null> {
    const { referredUserId, referralCode, source = 'signup' } = params;

    // 1. Check referral code exists
    const referrerProfile = await this.repo.getProfileByCode(referralCode);
    if (!referrerProfile) {
      logger.warn(`[Attribution] Invalid referral code: ${referralCode}`);
      return null;
    }

    if (!referrerProfile.is_active) {
      logger.warn(`[Attribution] Inactive referral profile for code: ${referralCode}`);
      return null;
    }

    // 2. Prevent self-referral
    if (referrerProfile.user_id === referredUserId) {
      logger.warn(`[Attribution] Self-referral blocked: user ${referredUserId} tried code ${referralCode}`);
      return null;
    }

    // 3. Prevent double-attribution
    const existing = await this.repo.getAttributionByReferredUser(referredUserId);
    if (existing) {
      logger.warn(`[Attribution] User ${referredUserId} already attributed to ${existing.referrer_user_id}`);
      return existing; // Return existing rather than failing — idempotent behavior
    }

    // 4. Create attribution
    try {
      const attribution = await this.repo.createAttribution({
        referrerUserId: referrerProfile.user_id,
        referredUserId,
        referralCode,
        attributionSource: source,
      });

      // Increment referral count
      await this.repo.incrementReferralCount(referrerProfile.user_id);

      // Phase 5: Notify referrer
      NotificationService.getInstance().referralAttributed(referrerProfile.user_id, referralCode);

      logger.info(`[Attribution] Created: ${referrerProfile.user_id} → ${referredUserId} via ${referralCode}`);
      return attribution;
    } catch (error: any) {
      // Handle unique constraint violation (race condition)
      if (error.code === '23505') {
        logger.warn(`[Attribution] Duplicate attribution for user ${referredUserId} (race condition)`);
        return this.repo.getAttributionByReferredUser(referredUserId);
      }
      logger.error('[Attribution] Failed to create attribution', error);
      return null;
    }
  }

  /**
   * Get who referred a user (if anyone).
   */
  async getReferrer(referredUserId: string): Promise<ReferralAttribution | null> {
    return this.repo.getAttributionByReferredUser(referredUserId);
  }

  /**
   * Get all users referred by a specific user.
   */
  async getReferrals(referrerUserId: string, limit = 50): Promise<ReferralAttribution[]> {
    return this.repo.getAttributionsByReferrer(referrerUserId, limit);
  }
}
