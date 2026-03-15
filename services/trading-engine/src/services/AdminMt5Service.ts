/**
 * AdminMt5Service
 * 
 * Helper service to get the admin MT5 connector URL for analysis services.
 * Admin MT5 account is used for:
 * - Price feeds (PriceFeedClient)
 * - Market data analysis
 * - Strategy detection and confirmation
 * 
 * This is separate from user MT5 accounts which are only used for trade execution.
 */

import { getSystemSettingsService } from './SystemSettingsService';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('AdminMt5Service');

/**
 * Get the admin MT5 connector URL for analysis services
 * Falls back to env var or default if not configured
 */
export async function getAdminMt5ConnectorUrl(): Promise<string> {
  const settingsService = getSystemSettingsService();
  
  // Try to get from system settings first
  const adminUrl = await settingsService.getSetting(
    'admin_mt5_connector_url',
    process.env.ADMIN_MT5_CONNECTOR_URL || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030'
  );
  
  logger.debug(`[AdminMt5Service] Admin MT5 connector URL: ${adminUrl}`);
  return adminUrl;
}

/**
 * Get the default MT5 connector URL for user accounts
 * This is used as a fallback when user doesn't provide baseUrl
 */
export async function getUserDefaultMt5ConnectorUrl(): Promise<string> {
  const settingsService = getSystemSettingsService();
  
  // Try to get from system settings first
  const userUrl = await settingsService.getSetting(
    'mt5_connector_url',
    process.env.MT5_CONNECTOR_URL || 'http://localhost:3030'
  );
  
  logger.debug(`[AdminMt5Service] User default MT5 connector URL: ${userUrl}`);
  return userUrl;
}

