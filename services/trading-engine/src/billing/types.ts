/**
 * Crypto Billing Domain Types — Phase 2
 */

// ==================== Payment Rails ====================

export type PaymentRail = 'USDT_TRON_TRC20' | 'USDC_BSC_BEP20';

export interface PaymentRailInfo {
  rail: PaymentRail;
  chain: string;
  token: string;
  displayName: string;
  confirmationsRequired: number;
  networkWarning: string;
}

export const SUPPORTED_RAILS: Record<PaymentRail, PaymentRailInfo> = {
  USDT_TRON_TRC20: {
    rail: 'USDT_TRON_TRC20',
    chain: 'TRON',
    token: 'USDT',
    displayName: 'USDT on TRON (TRC20)',
    confirmationsRequired: 20,
    networkWarning: 'Send only USDT on the TRON (TRC20) network. Sending other tokens or using other networks may result in permanent loss of funds.',
  },
  USDC_BSC_BEP20: {
    rail: 'USDC_BSC_BEP20',
    chain: 'BSC',
    token: 'USDC',
    displayName: 'USDC on BNB Smart Chain (BEP20)',
    confirmationsRequired: 15,
    networkWarning: 'Send only USDC on the BNB Smart Chain (BEP20) network. Sending other tokens or using other networks may result in permanent loss of funds.',
  },
};

// ==================== Invoice Status ====================

export type InvoiceStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'detected'
  | 'confirming'
  | 'paid'
  | 'underpaid'
  | 'overpaid'
  | 'expired'
  | 'failed'
  | 'manual_review';

export type InvoiceType = 'platform_plan' | 'mentor_plan';

// ==================== Platform Plans ====================

export interface PlatformPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_usd: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlatformSubscription {
  id: string;
  user_id: string;
  platform_plan_id: string;
  status: 'active' | 'expired' | 'cancelled';
  starts_at: string;
  expires_at: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Mentor Plans ====================

export interface MentorPlan {
  id: string;
  mentor_profile_id: string;
  name: string;
  description: string | null;
  price_usd: number;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  features: string[];
  created_at: string;
  updated_at: string;
}

export interface MentorPlanSubscription {
  id: string;
  user_id: string;
  mentor_plan_id: string;
  mentor_profile_id: string;
  status: 'active' | 'expired' | 'cancelled';
  starts_at: string;
  expires_at: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Invoices & Payments ====================

export interface CryptoPaymentInvoice {
  id: string;
  user_id: string;
  invoice_type: InvoiceType;
  platform_plan_id: string | null;
  mentor_plan_id: string | null;
  mentor_profile_id: string | null;
  fiat_currency: string;
  amount_fiat: number;
  payment_rail: PaymentRail;
  chain: string;
  token: string;
  amount_crypto_expected: number;
  amount_crypto_received: number;
  deposit_address: string;
  exchange_rate_snapshot_id: string | null;
  exchange_rate_used: number;
  status: InvoiceStatus;
  tx_hash: string | null;
  from_address: string | null;
  confirmation_count: number;
  confirmations_required: number;
  expires_at: string;
  paid_at: string | null;
  detected_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CryptoPaymentEvent {
  id: string;
  invoice_id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  tx_hash: string | null;
  amount_received: number | null;
  confirmation_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ExchangeRateSnapshot {
  id: string;
  fiat_currency: string;
  crypto_token: string;
  rate: number;
  source: string;
  captured_at: string;
}

// ==================== Revenue ====================

export interface RevenueLedgerEntry {
  id: string;
  invoice_id: string;
  mentor_profile_id: string | null;
  gross_amount_fiat: number;
  platform_fee_fiat: number;
  mentor_net_fiat: number;
  gross_amount_crypto: number;
  payment_rail: PaymentRail;
  platform_fee_pct: number;
  ledger_type: 'platform_revenue' | 'mentor_revenue';
  created_at: string;
}

// ==================== Sweep ====================

export interface CryptoPaymentSweep {
  id: string;
  source_address: string;
  destination_address: string;
  chain: string;
  token: string;
  payment_rail: PaymentRail;
  amount: number;
  tx_hash: string | null;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Entitlements ====================

export interface UserEntitlements {
  platformPlan: PlatformPlan | null;
  platformSubscription: PlatformSubscription | null;
  mentorSubscriptions: (MentorPlanSubscription & { plan?: MentorPlan })[];
  canAutoTrade: boolean;
  canSubscribeToMentors: boolean;
  maxMentorSubscriptions: number;
  hasApiAccess: boolean;
}

// ==================== Service Input Types ====================

export interface CreateInvoiceInput {
  userId: string;
  invoiceType: InvoiceType;
  platformPlanId?: string;
  mentorPlanId?: string;
  paymentRail: PaymentRail;
}

export interface CreateMentorPlanInput {
  mentorProfileId: string;
  name: string;
  description?: string;
  priceUsd: number;
  features?: string[];
  isPublic?: boolean;
}

export interface UpdateMentorPlanInput {
  name?: string;
  description?: string;
  priceUsd?: number;
  isActive?: boolean;
  isPublic?: boolean;
  features?: string[];
  sortOrder?: number;
}

// ==================== Config ====================

export const BILLING_CONFIG = {
  invoiceExpiryMinutes: 60,              // 1 hour to pay
  platformFeePct: 20,                    // 20% platform cut on mentor plans
  underpaymentThresholdPct: 2,           // Allow up to 2% underpayment
  subscriptionDurationDays: 30,          // Monthly billing
} as const;
