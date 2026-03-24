/**
 * Intelligence Domain Types — Phase 10
 */

export type WarningSeverity = 'info' | 'warning' | 'critical';

export interface RiskWarning {
  id: string;
  user_id: string;
  warning_type: string;
  severity: WarningSeverity;
  title: string;
  description: string;
  reason_codes: string[];
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, unknown>;
  is_dismissed: boolean;
  dismissed_at: string | null;
  created_at: string;
}

export interface MentorRecommendation {
  mentorId: string;
  mentorName: string;
  score: number;
  reasons: string[];
  matchType: string;
  analytics: {
    winRate: number;
    totalPnl: number;
    profitFactor: number;
    riskLabel: string;
    totalSignals: number;
    totalFollowers: number;
    avgRating: number;
  };
}

export interface MentorInsights {
  followerGrowth: { date: string; count: number }[];
  earningsTrend: { month: string; gross: number; net: number }[];
  planConversionRate: number;
  activeSubscribers: number;
  churnedSubscribers: number;
  shadowToLiveRate: number;
  topSymbols: { symbol: string; signals: number; winRate: number; pnl: number }[];
  signalEngagement: { month: string; signals: number; copies: number }[];
  recentReviewTrend: number;
}

export interface PlatformIntelligence {
  mentorConversionFunnel: { stage: string; count: number }[];
  referralFunnel: { stage: string; count: number }[];
  churnHotspots: { reason: string; count: number }[];
  planPerformance: { plan: string; subscribers: number; revenue: number }[];
  shadowToLiveRate: number;
  avgTimeToFirstTrade: number;
  importQualityRate: number;
  topBlockReasons: { reason: string; count: number }[];
}
