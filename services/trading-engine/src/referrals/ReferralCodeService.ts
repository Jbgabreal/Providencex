/**
 * ReferralCodeService — Code generation, validation, and profile management.
 */

import { Logger } from '@providencex/shared-utils';
import { ReferralRepository } from './ReferralRepository';
import { REFERRAL_CONFIG, type ReferralProfile } from './types';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';

const logger = new Logger('ReferralCodeService');

export class ReferralCodeService {
  constructor(
    private repo: ReferralRepository,
    private copyTradingRepo: CopyTradingRepository
  ) {}

  /**
   * Get or create a referral profile for a user.
   * Auto-detects if user is a mentor for affiliate status.
   */
  async getOrCreateProfile(userId: string): Promise<ReferralProfile> {
    let profile = await this.repo.getProfileByUserId(userId);
    if (profile) return profile;

    const code = await this.generateUniqueCode();
    const isMentor = await this.isUserMentor(userId);

    profile = await this.repo.createProfile({
      userId,
      referralCode: code,
      isMentorAffiliate: isMentor,
    });

    logger.info(`[Referral] Created profile for user ${userId}: code=${code}, mentor=${isMentor}`);
    return profile;
  }

  /**
   * Regenerate a user's referral code.
   */
  async regenerateCode(userId: string): Promise<ReferralProfile | null> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) return null;

    const newCode = await this.generateUniqueCode();
    const updated = await this.repo.updateProfileCode(userId, newCode);

    logger.info(`[Referral] Regenerated code for user ${userId}: ${profile.referral_code} → ${newCode}`);
    return updated;
  }

  /**
   * Look up a referral profile by code. Returns null if invalid/inactive.
   */
  async resolveCode(code: string): Promise<ReferralProfile | null> {
    if (!code || code.length < 3) return null;
    return this.repo.getProfileByCode(code);
  }

  /**
   * Sync mentor affiliate status (call when user becomes a mentor).
   */
  async syncMentorStatus(userId: string): Promise<void> {
    const isMentor = await this.isUserMentor(userId);
    const profile = await this.repo.getProfileByUserId(userId);
    if (profile && profile.is_mentor_affiliate !== isMentor) {
      await this.repo.setMentorAffiliate(userId, isMentor);
      logger.info(`[Referral] Updated mentor status for ${userId}: ${isMentor}`);
    }
  }

  // ==================== Private ====================

  private async generateUniqueCode(): Promise<string> {
    const { codePrefix, codeLength } = REFERRAL_CONFIG;
    let attempts = 0;
    while (attempts < 10) {
      const random = this.randomAlphanumeric(codeLength);
      const code = `${codePrefix}-${random}`.toUpperCase();
      const taken = await this.repo.isCodeTaken(code);
      if (!taken) return code;
      attempts++;
    }
    // Fallback: use timestamp-based code
    const ts = Date.now().toString(36).toUpperCase();
    return `${codePrefix}-${ts}`;
  }

  private randomAlphanumeric(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/1/0 to avoid confusion
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async isUserMentor(userId: string): Promise<boolean> {
    try {
      const mentorProfile = await this.copyTradingRepo.getMentorProfileByUserId(userId);
      return !!mentorProfile && mentorProfile.is_approved;
    } catch {
      return false;
    }
  }
}
