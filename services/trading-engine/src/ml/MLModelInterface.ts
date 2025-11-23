/**
 * ML Model Interface (Trading Engine v13)
 * 
 * Unified interface for ML models (LightGBM, ONNX, etc.)
 */

import { FeatureVector, MLSignalScore, MLModelMetadata } from './types';

/**
 * ML Model Interface - Unified interface for all ML models
 */
export interface MLModelInterface {
  /**
   * Load model from file
   */
  loadModel(modelPath: string): Promise<void>;

  /**
   * Predict ML signal score from features
   */
  predict(features: FeatureVector): Promise<MLSignalScore>;

  /**
   * Get model metadata
   */
  getMetadata(): MLModelMetadata;

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean;
}

