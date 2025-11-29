/**
 * Strategy Profile Store
 * 
 * Manages strategy profiles stored in JSON file (git-versioned)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StrategyProfile, StrategyProfileId } from './types';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('StrategyProfileStore');

// Path to profiles JSON file
const PROFILES_PATH = path.join(__dirname, 'strategy-profiles.json');

/**
 * Load all strategy profiles from disk
 */
export async function loadStrategyProfiles(): Promise<StrategyProfile[]> {
  try {
    const raw = await fs.readFile(PROFILES_PATH, 'utf8');
    const profiles = JSON.parse(raw) as StrategyProfile[];
    logger.info(`[StrategyProfileStore] Loaded ${profiles.length} strategy profile(s)`);
    return profiles;
  } catch (error) {
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`[StrategyProfileStore] Profiles file not found at ${PROFILES_PATH}, returning empty array`);
      return [];
    }
    logger.error(`[StrategyProfileStore] Error loading profiles:`, error);
    throw error;
  }
}

/**
 * Save strategy profiles to disk
 */
export async function saveStrategyProfiles(profiles: StrategyProfile[]): Promise<void> {
  try {
    // Ensure directory exists
    const dir = path.dirname(PROFILES_PATH);
    await fs.mkdir(dir, { recursive: true });
    
    // Write profiles with pretty formatting
    await fs.writeFile(PROFILES_PATH, JSON.stringify(profiles, null, 2), 'utf8');
    logger.info(`[StrategyProfileStore] Saved ${profiles.length} strategy profile(s) to ${PROFILES_PATH}`);
  } catch (error) {
    logger.error(`[StrategyProfileStore] Error saving profiles:`, error);
    throw error;
  }
}

/**
 * Get a single profile by key
 */
export async function getProfileByKey(key: string): Promise<StrategyProfile | null> {
  const profiles = await loadStrategyProfiles();
  return profiles.find(p => p.key === key && !p.isArchived) || null;
}

/**
 * Create a new profile from an existing one ("Save As")
 * 
 * @param baseKey Key of the profile to copy from
 * @param newKey New unique key for the copied profile
 * @param newDisplayName Display name for the new profile
 * @param overrides Partial config overrides
 * @returns The newly created profile
 */
export async function createProfileFromExisting(
  baseKey: string,
  newKey: string,
  newDisplayName: string,
  overrides: Partial<StrategyProfile['config']> = {}
): Promise<StrategyProfile> {
  const profiles = await loadStrategyProfiles();
  
  // Find base profile
  const baseProfile = profiles.find(p => p.key === baseKey && !p.isArchived);
  if (!baseProfile) {
    throw new Error(`Base profile not found: ${baseKey}`);
  }
  
  // Check if new key already exists
  if (profiles.some(p => p.key === newKey && !p.isArchived)) {
    throw new Error(`Profile with key "${newKey}" already exists`);
  }
  
  // Create new profile
  const now = new Date().toISOString();
  const newProfile: StrategyProfile = {
    ...baseProfile,
    id: newKey,
    key: newKey,
    displayName: newDisplayName,
    version: 1, // New profile starts at version 1
    createdAt: now,
    updatedAt: now,
    isDefault: false, // New profiles are not default
    isArchived: false,
    config: {
      ...baseProfile.config,
      ...overrides, // Apply overrides
    },
  };
  
  // Add to profiles array
  profiles.push(newProfile);
  await saveStrategyProfiles(profiles);
  
  logger.info(`[StrategyProfileStore] Created new profile "${newKey}" from "${baseKey}"`);
  return newProfile;
}

/**
 * Override an existing profile's configuration
 * 
 * @param key Profile key to override
 * @param newConfig New configuration (will merge with existing)
 * @returns The updated profile
 */
export async function overrideProfileConfig(
  key: string,
  newConfig: Record<string, any>
): Promise<StrategyProfile> {
  const profiles = await loadStrategyProfiles();
  
  // Find profile
  const profileIndex = profiles.findIndex(p => p.key === key && !p.isArchived);
  if (profileIndex === -1) {
    throw new Error(`Profile not found: ${key}`);
  }
  
  const profile = profiles[profileIndex];
  
  // Update profile
  const updatedProfile: StrategyProfile = {
    ...profile,
    version: profile.version + 1, // Increment version
    updatedAt: new Date().toISOString(),
    config: {
      ...profile.config,
      ...newConfig, // Merge new config
    },
  };
  
  // Replace in array
  profiles[profileIndex] = updatedProfile;
  await saveStrategyProfiles(profiles);
  
  logger.info(`[StrategyProfileStore] Overrode profile "${key}" (version ${updatedProfile.version})`);
  return updatedProfile;
}

/**
 * Get the default profile
 */
export async function getDefaultProfile(): Promise<StrategyProfile | null> {
  const profiles = await loadStrategyProfiles();
  return profiles.find(p => p.isDefault && !p.isArchived) || null;
}

