/**
 * SystemSettingsService
 * 
 * Provides access to system settings stored in the database.
 * Settings are cached to avoid repeated DB queries.
 * Services should use this to get settings that can be changed by admins.
 */

import { TenantRepository } from '../db/TenantRepository';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('SystemSettingsService');

// Cache for system settings
let settingsCache: Record<string, any> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000; // 1 minute

export class SystemSettingsService {
  private tenantRepo: TenantRepository;

  constructor() {
    this.tenantRepo = new TenantRepository();
  }

  /**
   * Get a system setting from database (with caching)
   * Falls back to defaultValue if not found or DB unavailable
   */
  async getSetting(key: string, defaultValue: string): Promise<string> {
    try {
      // Check cache first
      const now = Date.now();
      if (settingsCache && (now - cacheTimestamp) < CACHE_TTL) {
        const cached = settingsCache[key];
        if (cached !== undefined) {
          return typeof cached === 'string' ? cached : String(cached);
        }
      }

      // Query database
      const value = await this.tenantRepo.getSystemSetting(key);
      
      // Update cache
      if (!settingsCache) {
        settingsCache = {};
      }
      settingsCache[key] = value || defaultValue;
      cacheTimestamp = now;
      
      if (value) {
        const strValue = typeof value === 'string' ? value : String(value);
        // Remove JSON quotes if present
        return strValue.replace(/^"|"$/g, '');
      }
      
      return defaultValue;
    } catch (error) {
      logger.warn(`[SystemSettingsService] Failed to get setting '${key}', using default: ${defaultValue}`, error);
      return defaultValue;
    }
  }

  /**
   * Invalidate the settings cache (call after updating settings)
   */
  invalidateCache(): void {
    settingsCache = null;
    cacheTimestamp = 0;
    logger.debug('[SystemSettingsService] Cache invalidated');
  }

  /**
   * Get all settings (for admin use)
   */
  async getAllSettings(): Promise<Record<string, any>> {
    try {
      const settings = await this.tenantRepo.getAllSystemSettings();
      const result: Record<string, any> = {};
      settings.forEach(s => {
        result[s.key] = s.value;
      });
      return result;
    } catch (error) {
      logger.error('[SystemSettingsService] Failed to get all settings', error);
      return {};
    }
  }
}

// Singleton instance
let settingsServiceInstance: SystemSettingsService | null = null;

export function getSystemSettingsService(): SystemSettingsService {
  if (!settingsServiceInstance) {
    settingsServiceInstance = new SystemSettingsService();
  }
  return settingsServiceInstance;
}

