/**
 * BrokerAdapter — abstract interface for all broker integrations.
 *
 * MT5 accounts go through the existing MT5 connector (HTTP).
 * Deriv accounts use the Deriv WebSocket API.
 * Future brokers implement this same interface.
 */

import type {
  BrokerType,
  NormalizedTradeRequest,
  NormalizedTradeResult,
  BrokerAccountBalance,
} from './types';

export interface BrokerAdapter {
  readonly brokerType: BrokerType;

  /** Establish connection (WS connect, auth handshake, etc.) */
  connect(): Promise<void>;

  /** Tear down connection */
  disconnect(): Promise<void>;

  /** Whether the adapter is ready to accept trades */
  isConnected(): boolean;

  /** Open a trade */
  openTrade(request: NormalizedTradeRequest): Promise<NormalizedTradeResult>;

  /** Close / sell an open position */
  closeTrade(ticket: string | number, reason?: string): Promise<NormalizedTradeResult>;

  /** Get account balance */
  getBalance(): Promise<BrokerAccountBalance>;
}
