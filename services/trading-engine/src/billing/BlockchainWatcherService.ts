/**
 * BlockchainWatcherService — Abstraction for on-chain payment verification.
 *
 * Provides a base interface and implementations for TRON (TRC20) and BSC (BEP20).
 * In v1, verification is triggered on-demand (poll/refresh) rather than via
 * persistent websocket connections. The design supports upgrading to
 * event-driven watchers later.
 */

import { Logger } from '@providencex/shared-utils';

const logger = new Logger('BlockchainWatcher');

export interface TransactionInfo {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  token: string;
  confirmations: number;
  isConfirmed: boolean;
  timestamp: number;
}

export interface BlockchainWatcher {
  chain: string;
  token: string;

  /**
   * Check for incoming token transfers to a deposit address.
   * Returns list of matching transactions.
   */
  checkForPayment(depositAddress: string, expectedAmount: number): Promise<TransactionInfo[]>;

  /**
   * Get confirmation count for a specific transaction.
   */
  getConfirmations(txHash: string): Promise<number>;
}

// ==================== TRON TRC20 Watcher ====================

export class TronTRC20Watcher implements BlockchainWatcher {
  chain = 'TRON';
  token = 'USDT';

  private apiBase: string;

  constructor(apiBase?: string) {
    this.apiBase = apiBase || 'https://api.trongrid.io';
  }

  async checkForPayment(depositAddress: string, expectedAmount: number): Promise<TransactionInfo[]> {
    try {
      // TronGrid API: Get TRC20 token transfers for an address
      // In production, use the actual TronGrid/TronScan API
      // For v1, this is the integration point — returns empty until real API is connected
      logger.info(`[TRON] Checking payments to ${depositAddress} for ${expectedAmount} USDT`);

      // TODO: Implement actual TronGrid API call
      // const url = `${this.apiBase}/v1/accounts/${depositAddress}/transactions/trc20`;
      // const response = await fetch(url);
      // Parse response and filter for USDT transfers

      // Placeholder: In production, this queries TronGrid
      return [];
    } catch (error) {
      logger.error('[TRON] Payment check failed', error);
      return [];
    }
  }

  async getConfirmations(txHash: string): Promise<number> {
    try {
      logger.info(`[TRON] Checking confirmations for ${txHash}`);
      // TODO: Query TronGrid for transaction info and calculate confirmations
      // const url = `${this.apiBase}/v1/transactions/${txHash}`;
      return 0;
    } catch (error) {
      logger.error('[TRON] Confirmation check failed', error);
      return 0;
    }
  }
}

// ==================== BSC BEP20 Watcher ====================

export class BscBEP20Watcher implements BlockchainWatcher {
  chain = 'BSC';
  token = 'USDC';

  private apiBase: string;

  constructor(apiBase?: string) {
    this.apiBase = apiBase || 'https://api.bscscan.com/api';
  }

  async checkForPayment(depositAddress: string, expectedAmount: number): Promise<TransactionInfo[]> {
    try {
      logger.info(`[BSC] Checking payments to ${depositAddress} for ${expectedAmount} USDC`);

      // TODO: Implement actual BSCScan API call
      // BEP20 token transfers endpoint:
      // ${this.apiBase}?module=account&action=tokentx&address=${depositAddress}&sort=desc
      // Filter for USDC contract address

      return [];
    } catch (error) {
      logger.error('[BSC] Payment check failed', error);
      return [];
    }
  }

  async getConfirmations(txHash: string): Promise<number> {
    try {
      logger.info(`[BSC] Checking confirmations for ${txHash}`);
      // TODO: Query BSCScan for transaction receipt
      // Compare block number to current block for confirmation count
      return 0;
    } catch (error) {
      logger.error('[BSC] Confirmation check failed', error);
      return 0;
    }
  }
}

// ==================== Watcher Factory ====================

const watchers: Record<string, BlockchainWatcher> = {
  USDT_TRON_TRC20: new TronTRC20Watcher(),
  USDC_BSC_BEP20: new BscBEP20Watcher(),
};

export function getWatcherForRail(paymentRail: string): BlockchainWatcher | null {
  return watchers[paymentRail] || null;
}
