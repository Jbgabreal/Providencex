/**
 * Account Registry (Trading Engine v12)
 * 
 * Manages account configuration and runtime state
 */

import { Logger } from '@providencex/shared-utils';
import { AccountInfo, loadAccountsFromConfig } from './AccountConfig';

const logger = new Logger('AccountRegistry');

/**
 * Account runtime state
 */
export interface AccountRuntimeState {
  accountId: string;
  paused: boolean; // Kill switch active
  lastError: string | null;
  lastErrorTime: number | null;
  lastTradeTime: number | null;
  lastTradeSymbol: string | null;
  isConnected: boolean; // MT5 connector connection status
}

/**
 * Account Registry - Manages account configuration and state
 */
export class AccountRegistry {
  private accounts: Map<string, AccountInfo> = new Map();
  private runtimeState: Map<string, AccountRuntimeState> = new Map();
  private configPath: string;

  constructor(configPath: string = 'configs/accounts.json') {
    this.configPath = configPath;
  }

  /**
   * Load accounts from configuration file
   */
  async loadAccounts(): Promise<void> {
    try {
      const accounts = await loadAccountsFromConfig(this.configPath);
      
      this.accounts.clear();
      this.runtimeState.clear();

      for (const account of accounts) {
        if (account.enabled !== false) {
          this.accounts.set(account.id, account);
          this.runtimeState.set(account.id, {
            accountId: account.id,
            paused: false,
            lastError: null,
            lastErrorTime: null,
            lastTradeTime: null,
            lastTradeSymbol: null,
            isConnected: true, // Assume connected initially
          });
        }
      }

      logger.info(`[AccountRegistry] Loaded ${this.accounts.size} enabled account(s)`);
    } catch (error) {
      logger.error('[AccountRegistry] Failed to load accounts', error);
      throw error;
    }
  }

  /**
   * Get account by ID
   */
  getAccount(accountId: string): AccountInfo | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Get all active accounts
   */
  getAllAccounts(): AccountInfo[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Get accounts that trade a specific symbol
   */
  getAccountsForSymbol(symbol: string): AccountInfo[] {
    return Array.from(this.accounts.values()).filter(
      acc => acc.symbols.includes(symbol.toUpperCase())
    );
  }

  /**
   * Check if multi-account mode is enabled
   */
  isMultiAccountMode(): boolean {
    return this.accounts.size > 0;
  }

  /**
   * Get runtime state for an account
   */
  getRuntimeState(accountId: string): AccountRuntimeState | undefined {
    return this.runtimeState.get(accountId);
  }

  /**
   * Update runtime state
   */
  updateRuntimeState(accountId: string, updates: Partial<AccountRuntimeState>): void {
    const current = this.runtimeState.get(accountId);
    if (current) {
      this.runtimeState.set(accountId, { ...current, ...updates });
    }
  }

  /**
   * Mark account as paused (kill switch)
   */
  pauseAccount(accountId: string, reason: string): void {
    this.updateRuntimeState(accountId, {
      paused: true,
      lastError: reason,
      lastErrorTime: Date.now(),
    });
    logger.warn(`[AccountRegistry] Account ${accountId} paused: ${reason}`);
  }

  /**
   * Resume account (kill switch cleared)
   */
  resumeAccount(accountId: string): void {
    this.updateRuntimeState(accountId, {
      paused: false,
      lastError: null,
      lastErrorTime: null,
    });
    logger.info(`[AccountRegistry] Account ${accountId} resumed`);
  }

  /**
   * Record successful trade
   */
  recordTrade(accountId: string, symbol: string): void {
    this.updateRuntimeState(accountId, {
      lastTradeTime: Date.now(),
      lastTradeSymbol: symbol,
    });
  }

  /**
   * Record error
   */
  recordError(accountId: string, error: string): void {
    this.updateRuntimeState(accountId, {
      lastError: error,
      lastErrorTime: Date.now(),
    });
  }

  /**
   * Update connection status
   */
  updateConnectionStatus(accountId: string, isConnected: boolean): void {
    this.updateRuntimeState(accountId, { isConnected });
  }
}

