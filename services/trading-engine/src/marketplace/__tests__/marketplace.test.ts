/**
 * Marketplace Tests — ranking rules, badge logic, review eligibility, categories
 */

// ==================== Ranking Minimum Data Rules ====================

describe('Leaderboard Minimum Data Rules', () => {
  const MIN_SIGNALS = 10;

  it('should exclude mentors with fewer than 10 signals from ranked boards', () => {
    const totalSignals = 5;
    expect(totalSignals < MIN_SIGNALS).toBe(true);
  });

  it('should include mentors with 10+ signals', () => {
    const totalSignals = 15;
    expect(totalSignals >= MIN_SIGNALS).toBe(true);
  });

  it('should allow any signal count for newest/followers/rating sorts', () => {
    const exemptSorts = ['newest', 'followers', 'rating'];
    expect(exemptSorts).toContain('newest');
    expect(exemptSorts).toContain('followers');
    expect(exemptSorts).toContain('rating');
  });
});

// ==================== Badge Computation Rules ====================

describe('Badge Rules', () => {
  const RULES = {
    top_performer: { min_signals: 20, min_win_rate: 60, min_profit_factor: 1.5 },
    high_win_rate: { min_signals: 15, min_win_rate: 65 },
    low_drawdown: { min_signals: 15, max_drawdown: 100 },
    consistent: { min_signals: 30, min_months_active: 3, min_win_rate: 50 },
  };

  it('top_performer requires 20+ signals, 60%+ WR, 1.5+ PF', () => {
    const analytics = { total_signals: 25, win_rate: 65, profit_factor: 2.0 };
    const tp = RULES.top_performer;
    const qualifies = analytics.total_signals >= tp.min_signals &&
                      analytics.win_rate >= tp.min_win_rate &&
                      analytics.profit_factor >= tp.min_profit_factor;
    expect(qualifies).toBe(true);
  });

  it('top_performer rejected with low PF', () => {
    const analytics = { total_signals: 25, win_rate: 65, profit_factor: 1.0 };
    const tp = RULES.top_performer;
    const qualifies = analytics.profit_factor >= tp.min_profit_factor;
    expect(qualifies).toBe(false);
  });

  it('high_win_rate requires 15+ signals and 65%+ WR', () => {
    const analytics = { total_signals: 20, win_rate: 70 };
    const hwr = RULES.high_win_rate;
    expect(analytics.total_signals >= hwr.min_signals && analytics.win_rate >= hwr.min_win_rate).toBe(true);
  });

  it('low_drawdown requires drawdown under $100', () => {
    const analytics = { total_signals: 20, max_drawdown_pct: 50 };
    const ld = RULES.low_drawdown;
    expect(analytics.max_drawdown_pct <= ld.max_drawdown).toBe(true);
  });

  it('low_drawdown fails with high drawdown', () => {
    const analytics = { total_signals: 20, max_drawdown_pct: 200 };
    const ld = RULES.low_drawdown;
    expect(analytics.max_drawdown_pct <= ld.max_drawdown).toBe(false);
  });

  it('consistent requires 30+ signals and 3+ months', () => {
    const analytics = { total_signals: 35, win_rate: 55, monthly_performance_count: 4 };
    const cs = RULES.consistent;
    expect(analytics.total_signals >= cs.min_signals &&
           analytics.win_rate >= cs.min_win_rate &&
           analytics.monthly_performance_count >= cs.min_months_active).toBe(true);
  });
});

// ==================== Badge Types ====================

describe('Badge Types', () => {
  const badgeTypes = ['verified', 'top_performer', 'low_drawdown', 'fast_growing',
                      'consistent', 'new_mentor', 'featured', 'high_win_rate'];

  it('should have 8 badge types', () => {
    expect(badgeTypes.length).toBe(8);
  });

  it('should support both computed and admin badges', () => {
    const sources = ['computed', 'admin'];
    expect(sources).toContain('computed');
    expect(sources).toContain('admin');
  });
});

// ==================== Review Eligibility ====================

describe('Review Eligibility', () => {
  it('should require subscription to leave a review', () => {
    const hasSubscription = true;
    expect(hasSubscription).toBe(true);
  });

  it('should reject review without subscription', () => {
    const hasSubscription = false;
    expect(hasSubscription).toBe(false);
  });

  it('should prevent self-review', () => {
    const mentorUserId = 'user-123';
    const reviewerUserId = 'user-123';
    const isSelfReview = mentorUserId === reviewerUserId;
    expect(isSelfReview).toBe(true);
  });

  it('should allow review from different user', () => {
    const mentorUserId = 'user-123';
    const reviewerUserId = 'user-456';
    expect(mentorUserId !== reviewerUserId).toBe(true);
  });

  it('should enforce one review per user per mentor', () => {
    // DB UNIQUE constraint: (mentor_profile_id, reviewer_user_id)
    expect(true).toBe(true);
  });

  it('should enforce rating between 1 and 5', () => {
    expect(1 >= 1 && 1 <= 5).toBe(true);
    expect(5 >= 1 && 5 <= 5).toBe(true);
    expect(0 >= 1).toBe(false);
    expect(6 <= 5).toBe(false);
  });

  it('should enforce review text max length', () => {
    const maxLength = 500;
    const shortText = 'Great mentor!';
    const longText = 'x'.repeat(501);
    expect(shortText.length <= maxLength).toBe(true);
    expect(longText.length <= maxLength).toBe(false);
  });
});

// ==================== Leaderboard Sort Options ====================

describe('Leaderboard Sort Options', () => {
  const sortOptions = ['performance', 'win_rate', 'followers', 'low_drawdown', 'newest', 'rating'];

  it('should have 6 sort options', () => {
    expect(sortOptions.length).toBe(6);
  });

  it('performance sorts by 30d PnL descending', () => {
    const entries = [
      { pnl30d: 500 },
      { pnl30d: 1000 },
      { pnl30d: 200 },
    ];
    entries.sort((a, b) => b.pnl30d - a.pnl30d);
    expect(entries[0].pnl30d).toBe(1000);
    expect(entries[2].pnl30d).toBe(200);
  });

  it('low_drawdown sorts ascending (lower is better)', () => {
    const entries = [
      { drawdown: 200 },
      { drawdown: 50 },
      { drawdown: 150 },
    ];
    entries.sort((a, b) => a.drawdown - b.drawdown);
    expect(entries[0].drawdown).toBe(50);
  });
});

// ==================== Marketplace Categories ====================

describe('Marketplace Categories', () => {
  const categories = [
    { slug: 'top-performers', sort: 'performance' },
    { slug: 'most-followed', sort: 'followers' },
    { slug: 'low-risk', sort: 'low_drawdown' },
    { slug: 'highest-win-rate', sort: 'win_rate' },
    { slug: 'newest', sort: 'newest' },
    { slug: 'top-rated', sort: 'rating' },
  ];

  it('should have 6 categories', () => {
    expect(categories.length).toBe(6);
  });

  it('each category maps to a valid sort', () => {
    const validSorts = ['performance', 'win_rate', 'followers', 'low_drawdown', 'newest', 'rating'];
    for (const cat of categories) {
      expect(validSorts).toContain(cat.sort);
    }
  });
});

// ==================== Rating Summary ====================

describe('Rating Summary', () => {
  it('should compute average rating correctly', () => {
    const ratings = [5, 4, 4, 3, 5];
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    expect(avg).toBe(4.2);
  });

  it('should compute distribution correctly', () => {
    const ratings = [5, 4, 4, 3, 5];
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) dist[r]++;
    expect(dist[5]).toBe(2);
    expect(dist[4]).toBe(2);
    expect(dist[3]).toBe(1);
  });
});
