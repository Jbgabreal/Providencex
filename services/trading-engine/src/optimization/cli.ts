#!/usr/bin/env node

/**
 * Optimization CLI (Trading Engine v11)
 * 
 * Usage:
 *   pnpm optimize --method grid --symbol XAUUSD --from 2023-01-01 --to 2025-01-01
 *   pnpm optimize --method random --symbol XAUUSD --trials 50
 *   pnpm optimize --method bayes --symbol XAUUSD,EURUSD --trials 100
 *   pnpm optimize --method walkforward --symbol XAUUSD --walkForwardWindows 5
 */

import { OptimizerRunner } from './OptimizerRunner';
import { OptimizationMethod } from './OptimizationTypes';

// Parse command-line arguments
const args = process.argv.slice(2);
const parsedArgs: Record<string, string | number | boolean | string[]> = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, '');
  const value = args[i + 1];

  if (!key || !value) continue;

  // Parse special values
  if (value === 'true') {
    parsedArgs[key] = true;
  } else if (value === 'false') {
    parsedArgs[key] = false;
  } else if (!isNaN(Number(value))) {
    parsedArgs[key] = Number(value);
  } else if (value.includes(',')) {
    parsedArgs[key] = value.split(',');
  } else {
    parsedArgs[key] = value;
  }
}

// Validate required arguments
if (!parsedArgs.method) {
  console.error('Error: --method is required (grid|random|bayes|walkforward)');
  process.exit(1);
}

if (!parsedArgs.symbol) {
  console.error('Error: --symbol is required (e.g., XAUUSD or XAUUSD,EURUSD)');
  process.exit(1);
}

if (!parsedArgs.from || !parsedArgs.to) {
  console.error('Error: --from and --to are required (YYYY-MM-DD format)');
  process.exit(1);
}

// Run optimizer
const runner = new OptimizerRunner();

runner
  .run({
    method: parsedArgs.method as OptimizationMethod,
    symbol: parsedArgs.symbol as string | string[],
    from: parsedArgs.from as string,
    to: parsedArgs.to as string,
    outOfSampleFrom: parsedArgs.outOfSampleFrom as string | undefined,
    outOfSampleTo: parsedArgs.outOfSampleTo as string | undefined,
    paramGridPath: parsedArgs.paramGridPath as string | undefined,
    paramRangesPath: parsedArgs.paramRangesPath as string | undefined,
    trials: parsedArgs.trials as number | undefined,
    walkForwardWindows: parsedArgs.walkForwardWindows as number | undefined,
    walkForwardStep: parsedArgs.walkForwardStep as number | undefined,
    population: parsedArgs.population as number | undefined,
    generations: parsedArgs.generations as number | undefined,
    exportCsv: parsedArgs.exportCsv === true,
    saveDb: parsedArgs.saveDb !== false,
    parallelRuns: parsedArgs.parallelRuns as number | undefined,
  })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Optimization failed:', error);
    process.exit(1);
  });

