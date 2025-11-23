/**
 * Optimization Configuration (Trading Engine v11)
 * 
 * Provides default configuration for optimization engine
 */

import { OptimizerConfig } from './OptimizationTypes';

/**
 * Get default optimizer configuration
 */
export function getOptimizerConfig(): OptimizerConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
    maxParallelRuns: parseInt(process.env.OPTIMIZER_MAX_PARALLEL_RUNS || '4', 10),
    defaultTrials: parseInt(process.env.OPTIMIZER_DEFAULT_TRIALS || '50', 10),
    defaultWalkForwardWindows: parseInt(process.env.OPTIMIZER_DEFAULT_WF_WINDOWS || '5', 10),
    defaultWalkForwardStep: parseInt(process.env.OPTIMIZER_DEFAULT_WF_STEP || '30', 10), // 30 days
    scoringWeights: {
      winRate: parseFloat(process.env.OPTIMIZER_WEIGHT_WIN_RATE || '0.25'),
      profitFactor: parseFloat(process.env.OPTIMIZER_WEIGHT_PROFIT_FACTOR || '0.30'),
      sharpeRatio: parseFloat(process.env.OPTIMIZER_WEIGHT_SHARPE || '0.25'),
      maxDrawdown: parseFloat(process.env.OPTIMIZER_WEIGHT_DRAWDOWN || '0.10'),
      stability: parseFloat(process.env.OPTIMIZER_WEIGHT_STABILITY || '0.10'),
    },
  };
}

/**
 * Default parameter ranges for SMC v2 (used in random/bayes search)
 */
export const DEFAULT_PARAM_RANGES = {
  htfSwingLookback: { min: 10, max: 40, type: 'int' as const },
  htfTrendWeight: { min: 0.5, max: 1.0, type: 'float' as const },
  itfBosSensitivity: { min: 0.5, max: 1.0, type: 'float' as const },
  itfLiquiditySweepTolerance: { min: 0.3, max: 0.8, type: 'float' as const },
  ltfRefinementDepth: { min: 1, max: 4, type: 'int' as const },
  ltfEntryRetracePct: { min: 10, max: 60, type: 'float' as const },
  fvgMinSize: { min: 1, max: 5, type: 'float' as const },
  fvgFillTolerancePct: { min: 10, max: 50, type: 'float' as const },
  obMinVolumeFactor: { min: 1.0, max: 3.0, type: 'float' as const },
  obWickBodyRatioMin: { min: 0.2, max: 0.6, type: 'float' as const },
  smtWeight: { min: 0, max: 1.0, type: 'float' as const },
  volatilityATRMultiplier: { min: 1.0, max: 3.0, type: 'float' as const },
  riskRewardTarget: { min: 1.5, max: 3.0, type: 'float' as const },
  stopLossTolerancePct: { min: 5, max: 20, type: 'float' as const },
};

