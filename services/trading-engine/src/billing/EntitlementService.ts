/**
 * EntitlementService — Checks user access based on billing state.
 * Separates access logic from billing mechanics.
 */

import { Logger } from '@providencex/shared-utils';
import { BillingRepository } from './BillingRepository';
import type { UserEntitlements, PlatformPlan } from './types';

const logger = new Logger('EntitlementService');

// Plan slug → entitlement rules
const PLAN_ENTITLEMENTS: Record<string, {
  canAutoTrade: boolean;
  canSubscribeToMentors: boolean;
  maxMentorSubscriptions: number;
  hasApiAccess: boolean;
}> = {
  free: {
    canAutoTrade: false,
    canSubscribeToMentors: false,
    maxMentorSubscriptions: 0,
    hasApiAccess: false,
  },
  pro: {
    canAutoTrade: true,
    canSubscribeToMentors: true,
    maxMentorSubscriptions: 3,
    hasApiAccess: false,
  },
  premium: {
    canAutoTrade: true,
    canSubscribeToMentors: true,
    maxMentorSubscriptions: 999,
    hasApiAccess: true,
  },
};

export class EntitlementService {
  constructor(private repo: BillingRepository) {}

  /**
   * Get full entitlements for a user.
   */
  async getUserEntitlements(userId: string): Promise<UserEntitlements> {
    // Get platform subscription
    const platformSub = await this.repo.getActivePlatformSubscription(userId);
    const plan: PlatformPlan | null = (platformSub as any)?.plan || null;
    const planSlug = plan?.slug || 'free';
    const rules = PLAN_ENTITLEMENTS[planSlug] || PLAN_ENTITLEMENTS.free;

    // Get mentor subscriptions
    const mentorSubs = await this.repo.getUserMentorSubscriptions(userId);
    const activeMentorSubs = mentorSubs.filter(s => s.status === 'active' && (!s.expires_at || new Date(s.expires_at) > new Date()));

    return {
      platformPlan: plan,
      platformSubscription: platformSub,
      mentorSubscriptions: activeMentorSubs,
      ...rules,
    };
  }

  /**
   * Check if user can enable auto-trade copy trading.
   */
  async canAutoTrade(userId: string): Promise<boolean> {
    const entitlements = await this.getUserEntitlements(userId);
    return entitlements.canAutoTrade;
  }

  /**
   * Check if user can subscribe to a paid mentor.
   */
  async canSubscribeToMentor(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const entitlements = await this.getUserEntitlements(userId);
    if (!entitlements.canSubscribeToMentors) {
      return { allowed: false, reason: 'Upgrade to Pro or Premium plan to subscribe to mentors' };
    }
    const activeCount = entitlements.mentorSubscriptions.length;
    if (activeCount >= entitlements.maxMentorSubscriptions) {
      return { allowed: false, reason: `Maximum ${entitlements.maxMentorSubscriptions} mentor subscriptions on your plan` };
    }
    return { allowed: true };
  }

  /**
   * Check if user has active paid subscription to a specific mentor.
   */
  async hasMentorAccess(userId: string, mentorProfileId: string): Promise<boolean> {
    const sub = await this.repo.getActiveMentorSubscription(userId, mentorProfileId);
    return !!sub;
  }

  /**
   * Check if a mentor plan is free (no billing required).
   */
  async isMentorPlanFree(mentorPlanId: string): Promise<boolean> {
    const plan = await this.repo.getMentorPlanById(mentorPlanId);
    return !plan || Number(plan.price_usd) === 0;
  }
}
