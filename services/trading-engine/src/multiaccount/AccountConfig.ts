/**
 * Account Configuration (Trading Engine v12)
 * 
 * Defines types for multi-account configuration
 */

/**
 * MT5 Connection Information
 */
export interface MT5ConnectionInfo {
  baseUrl: string; // e.g., "http://localhost:4001"
  login: number; // MT5 account login
}

/**
 * Account Risk Configuration
 */
export interface AccountRiskConfig {
  riskPercent: number; // Risk per trade as percentage of equity (e.g., 1.0)
  maxDailyLoss: number; // Max daily loss in account currency (e.g., 200)
  maxWeeklyLoss: number; // Max weekly loss in account currency (e.g., 800)
  maxConcurrentTrades?: number; // Max concurrent trades for this account
  maxDailyRisk?: number; // Max daily risk amount in account currency
  maxExposure?: number; // Max total exposure in account currency
}

/**
 * Account Kill Switch Configuration
 */
export interface AccountKillSwitchConfig {
  enabled: boolean;
  dailyDDLimit: number; // Daily drawdown limit in account currency (e.g., 200)
  weeklyDDLimit: number; // Weekly drawdown limit in account currency (e.g., 800)
  maxConsecutiveLosses?: number; // Max consecutive losses before kill switch
  maxSpreadPips?: number; // Max spread in pips before kill switch
  maxExposure?: number; // Max exposure before kill switch
}

/**
 * Account Execution Filter Configuration (optional overrides)
 */
export interface AccountExecutionFilterConfig {
  maxTradesPerDay?: number; // Override global max trades per day
  cooldownMinutes?: number; // Override global cooldown
  minSpreadPips?: number; // Override global min spread
  sessionWindows?: string[]; // Override allowed sessions
}

/**
 * Complete Account Information
 */
export interface AccountInfo {
  id: string; // Unique account identifier (e.g., "acc1")
  name: string; // Human-readable name (e.g., "Main Account")
  mt5: MT5ConnectionInfo;
  symbols: string[]; // Symbols this account trades (e.g., ["XAUUSD", "US30"])
  risk: AccountRiskConfig;
  killSwitch: AccountKillSwitchConfig;
  executionFilter?: AccountExecutionFilterConfig; // Optional per-account filter overrides
  enabled?: boolean; // Whether account is enabled (default: true)
  metadata?: Record<string, any>; // Optional metadata (e.g., userId, mt5AccountId, strategyProfileId for multi-tenant)
}

/**
 * Load accounts from JSON configuration file
 */
export async function loadAccountsFromConfig(configPath: string = 'configs/accounts.json'): Promise<AccountInfo[]> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const fullPath = path.resolve(process.cwd(), configPath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const accounts: AccountInfo[] = JSON.parse(content);
    
    // Validate and set defaults
    return accounts.map(acc => ({
      ...acc,
      enabled: acc.enabled !== false, // Default to true
    }));
  } catch (error) {
    // If config file doesn't exist, return empty array (backward compatible - single account mode)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

