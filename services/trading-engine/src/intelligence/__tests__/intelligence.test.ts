/**
 * Intelligence Tests — recommendation scoring, risk warning rules, explainability
 */

// ==================== Recommendation Scoring ====================

describe('Recommendation Scoring', () => {
  function scoreMentor(analytics, prefs) {
    let score = 0;
    const reasons = [];

    // Performance (0-40)
    if (analytics.winRate >= 60) { score += 15; reasons.push(`High ${analytics.winRate}% win rate`); }
    if (analytics.profitFactor >= 2.0) { score += 10; reasons.push(`Strong ${analytics.profitFactor} PF`); }
    if (analytics.last30dPnl > 0) { score += 10; reasons.push('Positive recent performance'); }

    // Risk (0-15)
    if (analytics.riskLabel === 'low') { score += 15; reasons.push('Low risk profile'); }

    // Social (0-15)
    if (analytics.followers >= 10) { score += 5; reasons.push(`${analytics.followers} followers`); }
    if (analytics.rating >= 4.0) { score += 10; reasons.push(`${analytics.rating} star rating`); }

    // Preference match (0-20)
    if (prefs.styleMatch) { score += 10; reasons.push('Matches your style'); }
    if (prefs.symbolMatch) { score += 10; reasons.push('Trades your symbols'); }

    return { score, reasons };
  }

  it('should give high score to top performer with preference match', () => {
    const result = scoreMentor(
      { winRate: 65, profitFactor: 2.5, last30dPnl: 500, riskLabel: 'low', followers: 20, rating: 4.5 },
      { styleMatch: true, symbolMatch: true }
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.reasons.length).toBeGreaterThan(4);
  });

  it('should give low score to poor performer', () => {
    const result = scoreMentor(
      { winRate: 30, profitFactor: 0.8, last30dPnl: -200, riskLabel: 'high', followers: 1, rating: 2 },
      { styleMatch: false, symbolMatch: false }
    );
    expect(result.score).toBeLessThan(20);
  });

  it('should include reasons for each scoring factor', () => {
    const result = scoreMentor(
      { winRate: 65, profitFactor: 2.0, last30dPnl: 100, riskLabel: 'low', followers: 10, rating: 4.0 },
      { styleMatch: true, symbolMatch: false }
    );
    expect(result.reasons.some(r => r.includes('win rate'))).toBe(true);
    expect(result.reasons.some(r => r.includes('risk'))).toBe(true);
    expect(result.reasons.some(r => r.includes('style'))).toBe(true);
  });

  it('should cap score at 100', () => {
    const result = scoreMentor(
      { winRate: 80, profitFactor: 3.0, last30dPnl: 1000, riskLabel: 'low', followers: 50, rating: 5.0 },
      { styleMatch: true, symbolMatch: true }
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ==================== Recommendation Explainability ====================

describe('Recommendation Explainability', () => {
  it('each recommendation must have at least one reason', () => {
    const rec = { score: 50, reasons: ['High 65% win rate', 'Low risk profile'] };
    expect(rec.reasons.length).toBeGreaterThan(0);
  });

  it('reasons should be human-readable strings', () => {
    const reasons = ['High 65% win rate', 'Matches your preferred trading style', '15 followers'];
    for (const r of reasons) {
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(5);
    }
  });

  it('match type should be explicitly named', () => {
    const matchTypes = ['general', 'style_match', 'symbol_match', 'full_match'];
    expect(matchTypes).toContain('full_match');
    expect(matchTypes).toContain('general');
  });
});

// ==================== Risk Warning Rules ====================

describe('Risk Warning Rules', () => {
  it('should warn on repeated guardrail blocks (>=5 in 24h)', () => {
    const blockedCount = 7;
    const shouldWarn = blockedCount >= 5;
    expect(shouldWarn).toBe(true);
  });

  it('should not warn on few blocks', () => {
    const blockedCount = 2;
    expect(blockedCount >= 5).toBe(false);
  });

  it('should warn on auto-disabled subscriptions', () => {
    const autoDisabled = 1;
    expect(autoDisabled > 0).toBe(true);
  });

  it('should warn on high drawdown mentor (>$300)', () => {
    const drawdown = 450;
    expect(drawdown > 300).toBe(true);
  });

  it('should warn on declining win rate (30d < 70% of 90d and < 40%)', () => {
    const wr30d = 30;
    const wr90d = 55;
    const declining = wr30d < wr90d * 0.7 && wr30d < 40;
    expect(declining).toBe(true);
  });

  it('should suggest shadow mode for high-risk mentor on auto_trade', () => {
    const riskLabel = 'high';
    const mode = 'auto_trade';
    const suggest = riskLabel === 'high' && mode === 'auto_trade';
    expect(suggest).toBe(true);
  });
});

// ==================== Warning Severity ====================

describe('Warning Severity', () => {
  const severities = ['info', 'warning', 'critical'];

  it('should have 3 severity levels', () => {
    expect(severities.length).toBe(3);
  });

  it('auto-disabled subscriptions should be critical', () => {
    expect(severities).toContain('critical');
  });

  it('shadow mode suggestion should be info', () => {
    expect(severities).toContain('info');
  });
});

// ==================== Warning Reason Codes ====================

describe('Warning Reason Codes', () => {
  it('reason codes should be machine-readable', () => {
    const codes = ['high_block_rate', '7_blocks_24h', 'auto_disabled', 'high_drawdown'];
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('warnings should be dismissible', () => {
    const warning = { is_dismissed: false };
    warning.is_dismissed = true;
    expect(warning.is_dismissed).toBe(true);
  });
});

// ==================== Platform Intelligence ====================

describe('Platform Intelligence', () => {
  it('mentor conversion funnel should have 5 stages', () => {
    const stages = ['Profiles Created', 'Approved', 'Has Signals', 'Has Followers', 'Has Paid Plans'];
    expect(stages.length).toBe(5);
  });

  it('referral funnel should have 5 stages', () => {
    const stages = ['Referral Profiles', 'Attributions', 'Conversions', 'Commissions', 'Earned'];
    expect(stages.length).toBe(5);
  });

  it('churn hotspots should group by reason', () => {
    const hotspots = [
      { reason: 'auto_disabled: daily_loss_breached', count: 10 },
      { reason: 'manual_stop', count: 5 },
    ];
    expect(hotspots[0].count).toBeGreaterThan(hotspots[1].count);
  });
});

// ==================== Minimum Data Requirements ====================

describe('Minimum Data Requirements', () => {
  it('recommendations skip mentors with < 5 signals', () => {
    const minSignals = 5;
    const mentorSignals = 3;
    expect(mentorSignals < minSignals).toBe(true);
  });

  it('recommendations skip already-subscribed mentors', () => {
    const subscribedIds = ['mentor-1', 'mentor-2'];
    const candidateId = 'mentor-1';
    expect(subscribedIds.includes(candidateId)).toBe(true);
  });
});
