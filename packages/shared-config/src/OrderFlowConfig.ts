/**
 * Order Flow Configuration (Trading Engine v14)
 */

export interface OrderFlowConfig {
  enabled: boolean;
  pollIntervalMs: number; // Poll interval in milliseconds (default: 1000)
  largeOrderMultiplier: number; // Multiplier for large order detection (default: 20x)
  minDeltaTrendConfirmation: number; // Minimum delta for trend confirmation (default: 50)
  exhaustionThreshold: number; // Delta exhaustion threshold (default: 70)
  absorptionLookback: number; // Absorption detection lookback in seconds (default: 5)
}

/**
 * Get order flow configuration from environment variables
 */
export function getOrderFlowConfig(): OrderFlowConfig {
  return {
    enabled: process.env.ORDER_FLOW_ENABLED !== 'false', // Default: enabled
    pollIntervalMs: parseInt(process.env.ORDER_FLOW_POLL_INTERVAL_MS || '1000', 10),
    largeOrderMultiplier: parseFloat(process.env.ORDER_FLOW_LARGE_ORDER_MULTIPLIER || '20'),
    minDeltaTrendConfirmation: parseFloat(process.env.ORDER_FLOW_MIN_DELTA_TREND_CONFIRMATION || '50'),
    exhaustionThreshold: parseFloat(process.env.ORDER_FLOW_EXHAUSTION_THRESHOLD || '70'),
    absorptionLookback: parseInt(process.env.ORDER_FLOW_ABSORPTION_LOOKBACK || '5', 10),
  };
}

