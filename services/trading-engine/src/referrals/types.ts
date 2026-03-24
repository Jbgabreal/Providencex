/**
 * Referral Program Domain Types — Phase 3
 */

// ==================== Commission Status Lifecycle ====================
// pending → earned → payout_ready → paid_out
//        ↘ cancelled (at any point before paid_out)

export type CommissionStatus = 'pending' | 'earned' | 'cancelled' | 'payout_ready' | 'paid_out';
export type ConversionType = 'platform_plan' | 'mentor_plan';
export type AttributionSource = 'signup' | 'manual' | 'link';

// ==================== Entities ====================

export interface ReferralProfile {
  id: string;
  user_id: string;
  referral_code: string;
  is_mentor_affiliate: boolean;
  is_active: boolean;
  total_referrals: number;
  total_conversions: number;
  total_earned_fiat: number;
  created_at: string;
  updated_at: string;
}

export interface ReferralAttribution {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  referral_code: string;
  attribution_source: AttributionSource;
  created_at: string;
}

export interface ReferralConversion {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  attribution_id: string;
  conversion_type: ConversionType;
  revenue_source_id: string;
  idempotency_key: string;
  gross_amount_fiat: number;
  currency: string;
  created_at: string;
}

export interface ReferralCommission {
  id: string;
  referrer_user_id: string;
  conversion_id: string;
  gross_amount_fiat: number;
  commission_rate_pct: number;
  commission_amount_fiat: number;
  currency: string;
  status: CommissionStatus;
  payout_id: string | null;
  paid_out_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralPayout {
  id: string;
  referrer_user_id: string;
  total_amount_fiat: number;
  currency: string;
  payment_rail: string | null;
  tx_hash: string | null;
  destination_address: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

// ==================== Summary Types ====================

export interface ReferralSummary {
  profile: ReferralProfile;
  referralLink: string;
  totalReferrals: number;
  totalConversions: number;
  pendingCommissions: number;
  earnedCommissions: number;
  totalEarned: number;
  payoutReady: number;
}

// ==================== Config ====================

export const REFERRAL_CONFIG = {
  /** Commission rate for standard user referrals (% of gross revenue) */
  userCommissionPct: 10,
  /** Commission rate for mentor affiliate referrals (% of gross revenue) */
  mentorAffiliateCommissionPct: 15,
  /** Prefix for generated referral codes */
  codePrefix: 'PX',
  /** Length of random part of referral code */
  codeLength: 8,
  /** Base URL for referral links */
  referralLinkBase: '/login?ref=',
} as const;
