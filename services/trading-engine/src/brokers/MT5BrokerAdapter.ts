/**
 * MT5BrokerAdapter — wraps the existing MT5 connector HTTP API.
 *
 * This is the current behavior extracted into the adapter interface.
 * Each instance talks to one MT5 connector process via HTTP.
 */

import axios from 'axios';
import { Logger } from '@providencex/shared-utils';
import { TradeRequest, TradeResponse } from '@providencex/shared-types';
import type { BrokerAdapter } from './BrokerAdapter';
import type {
  NormalizedTradeRequest,
  NormalizedTradeResult,
  BrokerAccountBalance,
} from './types';

const logger = new Logger('MT5BrokerAdapter');

export interface MT5AdapterConfig {
  baseUrl: string;
  login?: number;
  password?: string;
  server?: string;
  terminalPath?: string;
}

export class MT5BrokerAdapter implements BrokerAdapter {
  readonly brokerType = 'mt5' as const;
  private baseUrl: string;
  private config: MT5AdapterConfig;

  constructor(config: MT5AdapterConfig) {
    this.baseUrl = config.baseUrl;
    this.config = config;
  }

  async connect(): Promise<void> {
    // HTTP is stateless — nothing to do
  }

  async disconnect(): Promise<void> {
    // HTTP is stateless — nothing to do
  }

  isConnected(): boolean {
    return true; // Always ready (stateless HTTP)
  }

  async openTrade(request: NormalizedTradeRequest): Promise<NormalizedTradeResult> {
    try {
      const tradeRequest: any = {
        symbol: request.symbol,
        direction: request.direction,
        entry_type: request.orderKind === 'market' ? 'MARKET' : request.orderKind === 'limit' ? 'LIMIT' : 'STOP',
        order_kind: request.orderKind,
        entry_price: request.entryPrice,
        lot_size: request.lotSize,
        stop_loss_price: request.stopLossPrice,
        take_profit_price: request.takeProfitPrice,
        strategy_id: request.strategyId,
        metadata: request.metadata,
      };

      // Multi-account: pass credentials so connector can switch accounts
      if (this.config.login && this.config.password) {
        tradeRequest.account = {
          mt5_login: this.config.login,
          mt5_password: this.config.password,
          mt5_server: this.config.server || '',
          mt5_terminal_path: this.config.terminalPath || null,
        };
      }

      const response = await axios.post<TradeResponse>(
        `${this.baseUrl}/api/v1/trades/open`,
        tradeRequest,
        { timeout: 10000, validateStatus: (s) => s < 500 }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info(`[MT5] Trade opened: ticket ${response.data.mt5_ticket}`);
        return {
          success: true,
          ticket: response.data.mt5_ticket,
          brokerType: 'mt5',
          rawResponse: response.data,
        };
      }

      const errData = response.data as any;
      const errMsg = errData?.error || errData?.detail || `MT5 connector returned ${response.status}`;
      logger.error(`[MT5] Trade failed: ${errMsg}`);
      return { success: false, error: errMsg, brokerType: 'mt5' };
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[MT5] openTrade error: ${msg}`);
      return { success: false, error: msg, brokerType: 'mt5' };
    }
  }

  async closeTrade(ticket: string | number, reason?: string): Promise<NormalizedTradeResult> {
    try {
      const payload: any = { mt5_ticket: ticket, reason };
      if (this.config.login && this.config.password) {
        payload.account = {
          mt5_login: this.config.login,
          mt5_password: this.config.password,
          mt5_server: this.config.server || '',
          mt5_terminal_path: this.config.terminalPath || null,
        };
      }

      const response = await axios.post(
        `${this.baseUrl}/api/v1/trades/close`,
        payload,
        { timeout: 10000 }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info(`[MT5] Trade closed: ticket ${ticket}`);
        return { success: true, ticket, brokerType: 'mt5' };
      }
      return { success: false, error: `MT5 connector returned ${response.status}`, brokerType: 'mt5' };
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[MT5] closeTrade error: ${msg}`);
      return { success: false, error: msg, brokerType: 'mt5' };
    }
  }

  async getBalance(): Promise<BrokerAccountBalance> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/account/balance`, { timeout: 5000 });
      return {
        balance: response.data.balance ?? 0,
        equity: response.data.equity ?? response.data.balance ?? 0,
        currency: response.data.currency ?? 'USD',
      };
    } catch {
      // Fallback — the MT5 connector may not expose a balance endpoint
      return { balance: 0, equity: 0, currency: 'USD' };
    }
  }
}
