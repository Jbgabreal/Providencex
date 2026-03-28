/**
 * DerivBrokerAdapter — connects to Deriv via their WebSocket API.
 *
 * Flow: connect WS → authorize(token) → proposal → buy → sell
 * Docs: https://developers.deriv.com/docs/
 *
 * Supports both synthetic indices (binary options: CALL/PUT)
 * and Deriv MT5 forex symbols (frxXAUUSD, frxEURUSD, etc.)
 */

import WebSocket from 'ws';
import { Logger } from '@providencex/shared-utils';
import type { BrokerAdapter } from './BrokerAdapter';
import type {
  NormalizedTradeRequest,
  NormalizedTradeResult,
  BrokerAccountBalance,
} from './types';

const logger = new Logger('DerivBrokerAdapter');

// Map standard symbols to Deriv symbols
const SYMBOL_MAP: Record<string, string> = {
  XAUUSD: 'frxXAUUSD',
  EURUSD: 'frxEURUSD',
  GBPUSD: 'frxGBPUSD',
  USDJPY: 'frxUSDJPY',
  AUDUSD: 'frxAUDUSD',
  USDCAD: 'frxUSDCAD',
  USDCHF: 'frxUSDCHF',
  NZDUSD: 'frxNZDUSD',
  EURJPY: 'frxEURJPY',
  GBPJPY: 'frxGBPJPY',
  // Synthetics — map both V-style and R-style names to Deriv symbols
  R_100: 'R_100',
  R_50: 'R_50',
  R_25: 'R_25',
  R_10: 'R_10',
  V100: 'R_100',
  V50: 'R_50',
  V25: 'R_25',
  V10: 'R_10',
};

// ProvidenceX Deriv App ID — shared across all users
export const DERIV_APP_ID = process.env.DERIV_APP_ID || '131586';

// Synthetic indices that support multiplier contracts (CFD-like)
const SYNTHETIC_SYMBOLS = new Set(['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V']);

export interface DerivAdapterConfig {
  appId?: string;   // Defaults to DERIV_APP_ID
  apiToken: string;
  accountId?: string;
}

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DerivBrokerAdapter implements BrokerAdapter {
  readonly brokerType = 'deriv' as const;

  private ws: WebSocket | null = null;
  private config: DerivAdapterConfig;
  private connected = false;
  private authorized = false;
  private reqIdCounter = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private accountBalance = 0;
  private accountCurrency = 'USD';

  constructor(config: DerivAdapterConfig) {
    this.config = { ...config, appId: config.appId || DERIV_APP_ID };
  }

  async connect(): Promise<void> {
    if (this.connected && this.authorized) return;

    return new Promise((resolve, reject) => {
      const url = `wss://ws.derivws.com/websockets/v3?app_id=${this.config.appId}`;
      this.ws = new WebSocket(url);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Deriv WS connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('open', async () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        logger.info('[Deriv] WebSocket connected');

        // Start keepalive pings
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ping: 1 }));
          }
        }, 30000);

        // Authorize
        try {
          const authResult = await this.sendRequest({
            authorize: this.config.apiToken,
          });
          if (authResult.error) {
            reject(new Error(`Deriv auth failed: ${authResult.error.message}`));
            return;
          }
          this.authorized = true;
          this.accountBalance = authResult.authorize?.balance ?? 0;
          this.accountCurrency = authResult.authorize?.currency ?? 'USD';
          logger.info(`[Deriv] Authorized: ${authResult.authorize?.loginid}, balance=${this.accountBalance} ${this.accountCurrency}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          const reqId = msg.req_id;
          if (reqId && this.pendingRequests.has(reqId)) {
            const pending = this.pendingRequests.get(reqId)!;
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(reqId);
            pending.resolve(msg);
          }
          // Update balance from subscription
          if (msg.msg_type === 'balance') {
            this.accountBalance = msg.balance?.balance ?? this.accountBalance;
          }
        } catch (err) {
          logger.error('[Deriv] Failed to parse message', err);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.authorized = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        logger.info('[Deriv] WebSocket closed');
        // Reject any pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('WebSocket closed'));
        }
        this.pendingRequests.clear();
      });

      this.ws.on('error', (err: Error) => {
        logger.error('[Deriv] WebSocket error', err);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authorized = false;
  }

  isConnected(): boolean {
    return this.connected && this.authorized;
  }

  async openTrade(request: NormalizedTradeRequest): Promise<NormalizedTradeResult> {
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (err: any) {
        return { success: false, error: `Deriv connect failed: ${err.message}`, brokerType: 'deriv' };
      }
    }

    const derivSymbol = this.mapSymbol(request.symbol);
    const isSynthetic = SYNTHETIC_SYMBOLS.has(derivSymbol);

    try {
      if (isSynthetic) {
        return await this.openMultiplierTrade(request, derivSymbol);
      } else {
        return await this.openOptionsTrade(request, derivSymbol);
      }
    } catch (error: any) {
      logger.error(`[Deriv] openTrade error: ${error.message}`);
      return { success: false, error: error.message, brokerType: 'deriv' };
    }
  }

  /**
   * Open a multiplier contract (CFD-like) for synthetic indices.
   * MULTUP = BUY, MULTDOWN = SELL. Supports SL/TP, no expiry.
   */
  private async openMultiplierTrade(request: NormalizedTradeRequest, derivSymbol: string): Promise<NormalizedTradeResult> {
    const contractType = request.direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';
    // Stake = risk amount. lotSize from risk service represents the risk in USD.
    const stakeAmount = Math.max(1, Math.round(request.lotSize * 100 * 100) / 100);
    // Default multiplier for V25: 160 (lowest available = lowest risk)
    const multiplier = 160;

    // Build proposal with SL/TP
    const proposalPayload: any = {
      proposal: 1,
      amount: stakeAmount,
      basis: 'stake',
      contract_type: contractType,
      currency: this.accountCurrency,
      symbol: derivSymbol,
      multiplier,
    };

    // Add stop_loss and take_profit as absolute amounts (distance from entry in USD)
    if (request.stopLossPrice && request.entryPrice) {
      const slDistance = Math.abs(request.entryPrice - request.stopLossPrice);
      const slAmount = Math.round(stakeAmount * multiplier * (slDistance / request.entryPrice) * 100) / 100;
      if (slAmount > 0) {
        proposalPayload.limit_order = { ...(proposalPayload.limit_order || {}), stop_loss: slAmount };
      }
    }
    if (request.takeProfitPrice && request.entryPrice) {
      const tpDistance = Math.abs(request.takeProfitPrice - request.entryPrice);
      const tpAmount = Math.round(stakeAmount * multiplier * (tpDistance / request.entryPrice) * 100) / 100;
      if (tpAmount > 0) {
        proposalPayload.limit_order = { ...(proposalPayload.limit_order || {}), take_profit: tpAmount };
      }
    }

    logger.info(`[Deriv] Multiplier proposal: ${contractType} ${derivSymbol}, stake=${stakeAmount}, mult=${multiplier}, SL/TP=${JSON.stringify(proposalPayload.limit_order || {})}`);

    const proposalResult = await this.sendRequest(proposalPayload);
    if (proposalResult.error) {
      return { success: false, error: `Deriv proposal failed: ${proposalResult.error.message}`, brokerType: 'deriv' };
    }

    const proposalId = proposalResult.proposal?.id;
    if (!proposalId) {
      return { success: false, error: 'No proposal ID returned', brokerType: 'deriv' };
    }

    logger.info(`[Deriv] Multiplier proposal received: id=${proposalId}, ask=${proposalResult.proposal.display_value}`);

    // Buy the contract
    const buyPayload: any = { buy: proposalId, price: stakeAmount * 2 };
    const buyResult = await this.sendRequest(buyPayload);

    if (buyResult.error) {
      return { success: false, error: `Deriv buy failed: ${buyResult.error.message}`, brokerType: 'deriv' };
    }

    const contractId = buyResult.buy?.contract_id;
    const buyPrice = buyResult.buy?.buy_price;
    logger.info(`[Deriv] Multiplier trade opened: contract_id=${contractId}, buy_price=${buyPrice}, type=${contractType}`);

    return {
      success: true,
      ticket: contractId,
      brokerType: 'deriv',
      rawResponse: buyResult.buy,
    };
  }

  /**
   * Open a basic options contract (CALL/PUT) for non-synthetic symbols.
   */
  private async openOptionsTrade(request: NormalizedTradeRequest, derivSymbol: string): Promise<NormalizedTradeResult> {
    const contractType = request.direction === 'BUY' ? 'CALL' : 'PUT';
    const stakeAmount = Math.max(1, request.lotSize * 100);

    const proposalResult = await this.sendRequest({
      proposal: 1,
      amount: stakeAmount,
      basis: 'stake',
      contract_type: contractType,
      currency: this.accountCurrency,
      duration: 60,
      duration_unit: 'm',
      symbol: derivSymbol,
    });

    if (proposalResult.error) {
      return { success: false, error: `Deriv proposal failed: ${proposalResult.error.message}`, brokerType: 'deriv' };
    }

    const proposalId = proposalResult.proposal?.id;
    if (!proposalId) {
      return { success: false, error: 'No proposal ID returned', brokerType: 'deriv' };
    }

    logger.info(`[Deriv] Options proposal: id=${proposalId}, ask=${proposalResult.proposal.display_value}, payout=${proposalResult.proposal.payout}`);

    const buyResult = await this.sendRequest({
      buy: proposalId,
      price: stakeAmount * 2,
    });

    if (buyResult.error) {
      return { success: false, error: `Deriv buy failed: ${buyResult.error.message}`, brokerType: 'deriv' };
    }

    const contractId = buyResult.buy?.contract_id;
    const buyPrice = buyResult.buy?.buy_price;
    logger.info(`[Deriv] Options trade opened: contract_id=${contractId}, buy_price=${buyPrice}`);

    return {
      success: true,
      ticket: contractId,
      brokerType: 'deriv',
      rawResponse: buyResult.buy,
    };
  }

  async closeTrade(ticket: string | number, reason?: string): Promise<NormalizedTradeResult> {
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (err: any) {
        return { success: false, error: `Deriv connect failed: ${err.message}`, brokerType: 'deriv' };
      }
    }

    try {
      // Sell at market price (price=0 means accept any price)
      const sellResult = await this.sendRequest({
        sell: String(ticket),
        price: 0,
      });

      if (sellResult.error) {
        return {
          success: false,
          error: `Deriv sell failed: ${sellResult.error.message}`,
          brokerType: 'deriv',
        };
      }

      const soldFor = sellResult.sell?.sold_for;
      logger.info(`[Deriv] Contract sold: id=${ticket}, sold_for=${soldFor}, reason=${reason || 'N/A'}`);

      return {
        success: true,
        ticket,
        brokerType: 'deriv',
        rawResponse: sellResult.sell,
      };
    } catch (error: any) {
      logger.error(`[Deriv] closeTrade error: ${error.message}`);
      return { success: false, error: error.message, brokerType: 'deriv' };
    }
  }

  async modifyTrade(ticket: string | number, params: { stopLoss?: number; takeProfit?: number }): Promise<NormalizedTradeResult> {
    if (!this.isConnected()) {
      try { await this.connect(); } catch (err: any) {
        return { success: false, error: `Deriv connect failed: ${err.message}`, brokerType: 'deriv' };
      }
    }
    try {
      const updatePayload: any = { contract_update: 1, contract_id: String(ticket) };
      if (params.stopLoss !== undefined) {
        updatePayload.limit_order = { ...(updatePayload.limit_order || {}), stop_loss: params.stopLoss };
      }
      if (params.takeProfit !== undefined) {
        updatePayload.limit_order = { ...(updatePayload.limit_order || {}), take_profit: params.takeProfit };
      }
      const result = await this.sendRequest(updatePayload);
      if (result.error) {
        return { success: false, error: `Deriv modify failed: ${result.error.message}`, brokerType: 'deriv' };
      }
      return { success: true, ticket, brokerType: 'deriv' };
    } catch (error: any) {
      return { success: false, error: error.message, brokerType: 'deriv' };
    }
  }

  async getBalance(): Promise<BrokerAccountBalance> {
    if (!this.isConnected()) {
      return { balance: this.accountBalance, equity: this.accountBalance, currency: this.accountCurrency };
    }

    try {
      const result = await this.sendRequest({ balance: 1 });
      if (result.balance) {
        this.accountBalance = result.balance.balance;
        this.accountCurrency = result.balance.currency;
      }
    } catch {
      // Use cached values
    }

    return {
      balance: this.accountBalance,
      equity: this.accountBalance,
      currency: this.accountCurrency,
    };
  }

  // --- Private helpers ---

  private mapSymbol(symbol: string): string {
    return SYMBOL_MAP[symbol.toUpperCase()] || symbol;
  }

  private sendRequest(payload: Record<string, any>, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not open'));
      }

      const reqId = this.reqIdCounter++;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Deriv request timeout (req_id=${reqId})`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
    });
  }
}
