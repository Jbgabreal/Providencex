/**
 * ML Configuration (Trading Engine v13)
 * 
 * Loads ML configuration from configs/ml.json
 */

import { Logger } from '@providencex/shared-utils';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('MLConfig');

/**
 * ML configuration interface
 */
export interface MLConfig {
  enabled: boolean;
  modelType: 'lightgbm' | 'onnx';
  modelPath: string;
  minWinProbability: number; // Minimum win probability (0-1)
  minConfidence: number; // Minimum confidence (0-1)
  minExpectedMove: number; // Minimum expected move in price units
  debug: boolean; // Include features in logs
}

/**
 * Default ML configuration
 */
const DEFAULT_CONFIG: MLConfig = {
  enabled: false, // Disabled by default (backward compatible)
  modelType: 'lightgbm',
  modelPath: './ml_models/v13_model.txt',
  minWinProbability: 0.60,
  minConfidence: 0.40,
  minExpectedMove: 0.5,
  debug: false,
};

/**
 * Load ML configuration from file
 */
export function getMLConfig(): MLConfig {
  const configPath = path.resolve(process.cwd(), 'configs/ml.json');
  
  try {
    // Try to read config file (synchronous for simplicity, could be async)
    const configContent = require('fs').readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(configContent);
    
    // Merge with defaults
    const config: MLConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
    };
    
    logger.info(`[MLConfig] Loaded ML configuration from ${configPath}`);
    return config;
  } catch (error) {
    // Config file doesn't exist or invalid - use defaults
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info('[MLConfig] ML config file not found - using defaults (ML disabled)');
      return DEFAULT_CONFIG;
    }
    
    logger.error('[MLConfig] Failed to load ML configuration', error);
    return DEFAULT_CONFIG;
  }
}

