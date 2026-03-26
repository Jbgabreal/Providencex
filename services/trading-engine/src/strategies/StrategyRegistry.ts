/**
 * Strategy Registry
 * 
 * Central registry that maps implementation keys to strategy classes
 * and loads strategy profiles.
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy } from './types';
import { StrategyProfile } from './profiles/types';
import { loadStrategyProfiles, getProfileByKey } from './profiles/StrategyProfileStore';
import { GodSmcStrategy } from './god/GodSmcStrategy';
import { SilverBulletStrategy } from './silver-bullet/SilverBulletStrategy';

const logger = new Logger('StrategyRegistry');

/**
 * Map of implementation keys to strategy constructors
 * 
 * IMPORTANT: Once a strategy is registered here and used in production,
 * it should NEVER be removed or have its key changed. This ensures
 * backward compatibility with existing profiles.
 */
const implementationMap: Record<string, new (profile: StrategyProfile) => IStrategy> = {
  // Frozen immutable implementation
  GOD_SMC_V1: GodSmcStrategy,

  // ICT Silver Bullet — liquidity sweep + displacement + FVG entry
  SILVER_BULLET_V1: SilverBulletStrategy,
};

/**
 * Get a strategy implementation class by key
 */
export function getImplementation(implementationKey: string): new (profile: StrategyProfile) => IStrategy {
  const Ctor = implementationMap[implementationKey];
  if (!Ctor) {
    throw new Error(
      `Unknown strategy implementation key: ${implementationKey}. ` +
      `Available keys: ${Object.keys(implementationMap).join(', ')}`
    );
  }
  return Ctor;
}

/**
 * Get a fully wired strategy instance by profile key
 * 
 * @param profileKey Profile key (e.g., "first_successful_strategy_from_god")
 * @returns Fully initialized strategy instance
 */
export async function getStrategyByProfileKey(profileKey: string): Promise<IStrategy> {
  logger.info(`[StrategyRegistry] Loading strategy for profile: ${profileKey}`);
  
  // Load profile
  const profile = await getProfileByKey(profileKey);
  if (!profile) {
    throw new Error(`Strategy profile not found: ${profileKey}`);
  }
  
  if (profile.isArchived) {
    throw new Error(`Strategy profile is archived: ${profileKey}`);
  }
  
  // Get implementation class
  const Impl = getImplementation(profile.implementationKey);
  
  // Create instance with profile
  const strategy = new Impl(profile);
  
  logger.info(
    `[StrategyRegistry] Loaded strategy: ${strategy.displayName} ` +
    `(implementation: ${profile.implementationKey}, profile: ${profile.key})`
  );
  
  return strategy;
}

/**
 * Get all available strategy profiles
 */
export async function getAllProfiles(): Promise<StrategyProfile[]> {
  return await loadStrategyProfiles();
}

/**
 * Get all registered implementation keys
 */
export function getAvailableImplementationKeys(): string[] {
  return Object.keys(implementationMap);
}

