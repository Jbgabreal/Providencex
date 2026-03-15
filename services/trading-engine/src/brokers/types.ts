/**
 * Broker-agnostic types for the hybrid adapter system.
 */

export type BrokerType = 'mt5' | 'deriv';

export interface NormalizedTradeRequest {
  symbol: string;
  direction: 'BUY' | 'SELL';
  orderKind: 'market' | 'limit' | 'stop';
  entryPrice?: number;
  lotSize: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  strategyId: string;
  metadata?: Record<string, any>;
}

export interface NormalizedTradeResult {
  success: boolean;
  ticket?: string | number;
  error?: string;
  brokerType: BrokerType;
  rawResponse?: any;
}

export interface BrokerAccountBalance {
  balance: number;
  equity: number;
  currency: string;
}

export interface BrokerCredentials {
  // MT5
  baseUrl?: string;
  login?: number;
  // Deriv
  appId?: string;
  apiToken?: string;
  accountId?: string;
  [key: string]: any;
}
