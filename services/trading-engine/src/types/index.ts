// Trading Engine v1 Types

export type Strategy = "low" | "high";
export type TrendDirection = "bullish" | "bearish" | "sideways";
export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4";
export type GuardrailMode = "normal" | "reduced" | "blocked";

// Market Data Types
export interface Candle {
  timestamp: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Order Types
export type OrderKind = "market" | "limit" | "stop" | "stop_limit";

// Strategy Types
export interface TradeSignal {
  symbol: string;
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  orderKind?: OrderKind; // Optional: defaults to 'market' for backward compatibility
  stopLimitPrice?: number; // For stop_limit orders: the stop price that triggers the limit order
  meta?: Record<string, any>;
}

// Guardrail Types
export interface GuardrailDecision {
  can_trade: boolean;
  mode: GuardrailMode;
  active_windows: NewsWindow[];
  reason_summary: string;
}

// Import NewsWindow from shared-types
import { NewsWindow as SharedNewsWindow } from '@providencex/shared-types';
export type NewsWindow = SharedNewsWindow;

// Risk Types
export interface RiskContext {
  strategy: Strategy;
  account_equity: number;
  today_realized_pnl: number;
  trades_taken_today: number;
  guardrail_mode: GuardrailMode;
  symbol?: string; // v15: Optional symbol for per-symbol risk overrides
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjusted_risk_percent?: number; // Adjusted based on guardrail mode
}

// Execution Types
export interface ExecutionResult {
  success: boolean;
  ticket?: string | number;
  error?: string;
}

// Decision Logging Types
export interface TradeDecisionLog {
  id?: string;
  timestamp: string;
  symbol: string;
  strategy: Strategy;
  guardrail_mode: GuardrailMode;
  guardrail_reason: string;
  decision: "trade" | "skip";
  risk_reason?: string;
  signal_reason?: string;
  risk_score?: number | null;
  trade_request?: {
    direction: "buy" | "sell";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
  } | null;
  execution_result?: ExecutionResult | null;
  // v3 Execution Filter metadata
  execution_filter_action?: "skip" | "pass" | null;
  execution_filter_reasons?: string[] | null;
  // v8 Kill Switch metadata
  kill_switch_active?: boolean | null;
  kill_switch_reasons?: string[] | null;
  // v13 ML Alpha Layer metadata
  ml_pass?: boolean | null;
  ml_score?: {
    probabilityWin: number;
    probabilitySL: number;
    probabilityTP: number;
    expectedMove: number;
    confidence: number;
  } | null;
  ml_reasons?: string[] | null;
  regime?: string | null;
  features?: Record<string, number> | null;
  // v14 Order Flow metadata
  orderflow_snapshot?: {
    delta15s: number;
    buyPressureScore: number;
    sellPressureScore: number;
    orderImbalance: number;
    largeBuyOrders: number;
    largeSellOrders: number;
  } | null;
  orderflow_delta15s?: number | null;
  orderflow_order_imbalance?: number | null;
  orderflow_large_orders_against?: number | null;
}

// Market Structure Types (SMC)
export interface MarketStructure {
  trend: TrendDirection;
  last_swing_high?: number;
  last_swing_low?: number;
  order_blocks?: OrderBlock[];
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  timestamp: string;
  timeframe: Timeframe;
  mitigated: boolean;
}

