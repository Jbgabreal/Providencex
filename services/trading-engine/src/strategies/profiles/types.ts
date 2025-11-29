/**
 * Strategy Profile Types
 * 
 * Profiles bind a named configuration to a strategy implementation
 */

/**
 * Unique identifier for a strategy profile
 */
export type StrategyProfileId = string;

/**
 * Strategy Profile
 * 
 * A profile is a named, versioned configuration that binds:
 * - A human-readable name
 * - A unique key/slug
 * - The implementation class to use
 * - All config parameters (risk, R:R, filters, ICT/SMC toggles, etc.)
 */
export interface StrategyProfile {
  /**
   * Unique identifier (e.g., "first_successful_strategy_from_god")
   */
  id: StrategyProfileId;

  /**
   * Programmatic key (same as id, used for lookups)
   */
  key: string;

  /**
   * Human-readable display name
   */
  displayName: string;

  /**
   * Optional description
   */
  description?: string;

  /**
   * Implementation key that binds to a concrete IStrategy class
   * (e.g., "GOD_SMC_V1", "SMC_V2")
   */
  implementationKey: string;

  /**
   * Version number (incremented on override)
   */
  version: number;

  /**
   * ISO timestamp when profile was created
   */
  createdAt: string;

  /**
   * ISO timestamp when profile was last updated
   */
  updatedAt: string;

  /**
   * Whether this is the default profile
   */
  isDefault?: boolean;

  /**
   * Whether this profile is archived (hidden but not deleted)
   */
  isArchived?: boolean;

  /**
   * Strategy-specific configuration
   * 
   * Examples:
   * - riskRewardRatio: 3
   * - useICTModel: true
   * - smcRiskReward: 3
   * - entryFilters: {...}
   * - sessionFilters: {...}
   */
  config: Record<string, any>;
}

