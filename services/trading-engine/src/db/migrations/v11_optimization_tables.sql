-- Trading Engine v11 - Optimization Tables Migration
-- Creates tables for hyperparameter optimization and walk-forward analysis

-- Table: optimization_runs
-- Stores metadata about optimization runs
CREATE TABLE IF NOT EXISTS optimization_runs (
  id BIGSERIAL PRIMARY KEY,
  method VARCHAR(32) NOT NULL CHECK (method IN ('grid', 'random', 'bayes', 'walkforward', 'genetic')),
  symbol TEXT NOT NULL, -- Can store single symbol or JSON array of symbols
  param_set JSONB, -- SMC_V2_ParamSet or null for grid/random
  in_sample_range JSONB NOT NULL, -- {from: string, to: string}
  out_sample_range JSONB, -- {from: string, to: string} for walk-forward
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

-- Table: optimization_results
-- Stores individual optimization results for each parameter set tested
CREATE TABLE IF NOT EXISTS optimization_results (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES optimization_runs(id) ON DELETE CASCADE,
  param_set JSONB NOT NULL, -- SMC_V2_ParamSet
  metrics JSONB NOT NULL, -- OptimizationMetrics
  equity_curve JSONB, -- Array of EquityPoint
  trades JSONB, -- Array of OptimizationTrade
  ranked_score DOUBLE PRECISION, -- Composite score for ranking
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for optimization_runs
CREATE INDEX IF NOT EXISTS idx_optimization_runs_method ON optimization_runs(method);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_status ON optimization_runs(status);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_created_at ON optimization_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_symbol ON optimization_runs(symbol);

-- GIN indexes for JSONB columns in optimization_runs
CREATE INDEX IF NOT EXISTS idx_optimization_runs_param_set_gin ON optimization_runs USING GIN (param_set);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_in_sample_range_gin ON optimization_runs USING GIN (in_sample_range);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_out_sample_range_gin ON optimization_runs USING GIN (out_sample_range);

-- Indexes for optimization_results
CREATE INDEX IF NOT EXISTS idx_optimization_results_run_id ON optimization_results(run_id);
CREATE INDEX IF NOT EXISTS idx_optimization_results_ranked_score ON optimization_results(ranked_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_optimization_results_created_at ON optimization_results(created_at DESC);

-- GIN indexes for JSONB columns in optimization_results
CREATE INDEX IF NOT EXISTS idx_optimization_results_param_set_gin ON optimization_results USING GIN (param_set);
CREATE INDEX IF NOT EXISTS idx_optimization_results_metrics_gin ON optimization_results USING GIN (metrics);

-- Composite index for efficient queries
CREATE INDEX IF NOT EXISTS idx_optimization_results_run_id_score ON optimization_results(run_id, ranked_score DESC NULLS LAST);

