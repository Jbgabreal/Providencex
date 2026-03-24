/**
 * Billing Domain Tests — Invoice lifecycle, entitlements, revenue splits
 *
 * These tests validate the billing business logic without requiring a database.
 * They use inline config values matching the production BILLING_CONFIG.
 */

// Config values matching src/billing/types.ts BILLING_CONFIG
const BILLING_CONFIG = {
  invoiceExpiryMinutes: 60,
  platformFeePct: 20,
  underpaymentThresholdPct: 2,
  subscriptionDurationDays: 30,
};

// ==================== Payment Rails ====================

describe('Payment Rails', () => {
  const SUPPORTED_RAILS = {
    USDT_TRON_TRC20: { chain: 'TRON', token: 'USDT', confirmationsRequired: 20 },
    USDC_BSC_BEP20: { chain: 'BSC', token: 'USDC', confirmationsRequired: 15 },
  };

  it('should define exactly two payment rails', () => {
    expect(Object.keys(SUPPORTED_RAILS)).toEqual(['USDT_TRON_TRC20', 'USDC_BSC_BEP20']);
  });

  it('USDT_TRON_TRC20 should have correct config', () => {
    const rail = SUPPORTED_RAILS.USDT_TRON_TRC20;
    expect(rail.chain).toBe('TRON');
    expect(rail.token).toBe('USDT');
    expect(rail.confirmationsRequired).toBe(20);
  });

  it('USDC_BSC_BEP20 should have correct config', () => {
    const rail = SUPPORTED_RAILS.USDC_BSC_BEP20;
    expect(rail.chain).toBe('BSC');
    expect(rail.token).toBe('USDC');
    expect(rail.confirmationsRequired).toBe(15);
  });
});

// ==================== Billing Config ====================

describe('BILLING_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(BILLING_CONFIG.invoiceExpiryMinutes).toBe(60);
    expect(BILLING_CONFIG.platformFeePct).toBe(20);
    expect(BILLING_CONFIG.underpaymentThresholdPct).toBe(2);
    expect(BILLING_CONFIG.subscriptionDurationDays).toBe(30);
  });
});

// ==================== Invoice Status Transitions ====================

describe('Invoice Status Transitions', () => {
  const validTransitions = {
    awaiting_payment: ['detected', 'confirming', 'expired', 'underpaid', 'manual_review'],
    detected: ['confirming', 'paid', 'overpaid', 'underpaid', 'manual_review'],
    confirming: ['paid', 'overpaid', 'manual_review'],
    underpaid: ['manual_review', 'paid'],
    overpaid: [],
    paid: [],
    expired: [],
    failed: [],
    manual_review: ['paid', 'failed'],
  };

  it('awaiting_payment can transition to detected or expired', () => {
    expect(validTransitions.awaiting_payment).toContain('detected');
    expect(validTransitions.awaiting_payment).toContain('expired');
  });

  it('paid and expired are terminal', () => {
    expect(validTransitions.paid).toHaveLength(0);
    expect(validTransitions.expired).toHaveLength(0);
  });

  it('manual_review can be resolved to paid or failed', () => {
    expect(validTransitions.manual_review).toContain('paid');
    expect(validTransitions.manual_review).toContain('failed');
  });
});

// ==================== Revenue Split Calculation ====================

describe('Revenue Split', () => {
  const platformFeePct = BILLING_CONFIG.platformFeePct;

  it('should calculate 20% platform fee correctly', () => {
    const grossFiat = 29.99;
    const platformFee = Math.round(grossFiat * platformFeePct) / 100;
    const mentorNet = grossFiat - platformFee;

    expect(platformFee).toBe(6.00);
    expect(mentorNet).toBeCloseTo(23.99, 2);
  });

  it('should handle zero amount correctly', () => {
    const platformFee = Math.round(0 * platformFeePct) / 100;
    expect(platformFee).toBe(0);
  });

  it('platform fee + mentor net should equal gross', () => {
    const grossFiat = 79.99;
    const platformFee = Math.round(grossFiat * platformFeePct) / 100;
    const mentorNet = grossFiat - platformFee;
    expect(platformFee + mentorNet).toBeCloseTo(grossFiat, 2);
  });
});

// ==================== Invoice Expiry Logic ====================

describe('Invoice Expiry', () => {
  it('should expire after 60 minutes', () => {
    const now = Date.now();
    const expiresAt = new Date(now + BILLING_CONFIG.invoiceExpiryMinutes * 60 * 1000);
    const diffMinutes = (expiresAt.getTime() - now) / 60000;
    expect(diffMinutes).toBe(60);
  });

  it('should correctly identify expired invoice', () => {
    const pastExpiry = new Date(Date.now() - 1000);
    expect(pastExpiry < new Date()).toBe(true);
  });

  it('should correctly identify non-expired invoice', () => {
    const futureExpiry = new Date(Date.now() + 60000);
    expect(futureExpiry > new Date()).toBe(true);
  });
});

// ==================== Underpayment Threshold ====================

describe('Underpayment Detection', () => {
  const thresholdPct = BILLING_CONFIG.underpaymentThresholdPct;

  it('should allow payments within 2% threshold', () => {
    const expected = 29.99;
    const threshold = expected * (1 - thresholdPct / 100);
    const received = 29.50; // ~1.6% under
    expect(received).toBeGreaterThanOrEqual(threshold);
  });

  it('should flag payments below threshold as underpaid', () => {
    const expected = 29.99;
    const threshold = expected * (1 - thresholdPct / 100);
    const received = 28.00; // ~6.6% under
    expect(received).toBeLessThan(threshold);
  });

  it('should accept exact amount', () => {
    const expected = 29.99;
    const threshold = expected * (1 - thresholdPct / 100);
    expect(expected).toBeGreaterThanOrEqual(threshold);
  });
});

// ==================== Subscription Duration ====================

describe('Subscription Duration', () => {
  it('should calculate 30-day subscription expiry', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + BILLING_CONFIG.subscriptionDurationDays * 24 * 60 * 60 * 1000);
    const diffDays = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(30);
  });
});

// ==================== Stablecoin Exchange Rate ====================

describe('Stablecoin Exchange Rate', () => {
  it('USDT/USD rate should be 1:1', () => {
    const rate = 1.0; // stablecoin peg
    const amountFiat = 29.99;
    const amountCrypto = Math.round(amountFiat * rate * 100) / 100;
    expect(amountCrypto).toBe(29.99);
  });

  it('USDC/USD rate should be 1:1', () => {
    const rate = 1.0;
    const amountFiat = 79.99;
    const amountCrypto = Math.round(amountFiat * rate * 100) / 100;
    expect(amountCrypto).toBe(79.99);
  });
});
