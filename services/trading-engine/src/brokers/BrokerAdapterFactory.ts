/**
 * BrokerAdapterFactory — creates the right adapter based on broker_type.
 */

import { Logger } from '@providencex/shared-utils';
import type { BrokerAdapter } from './BrokerAdapter';
import type { BrokerType, BrokerCredentials } from './types';
import { MT5BrokerAdapter } from './MT5BrokerAdapter';
import { DerivBrokerAdapter } from './DerivBrokerAdapter';

const logger = new Logger('BrokerAdapterFactory');

export class BrokerAdapterFactory {
  /**
   * Create a broker adapter based on type and credentials.
   * For MT5, falls back to defaultMt5BaseUrl if no baseUrl in credentials.
   */
  static create(
    brokerType: BrokerType,
    credentials: BrokerCredentials,
    defaultMt5BaseUrl?: string
  ): BrokerAdapter {
    switch (brokerType) {
      case 'mt5':
        return new MT5BrokerAdapter({
          baseUrl: credentials.baseUrl || defaultMt5BaseUrl || 'http://localhost:3030',
          login: credentials.login,
        });

      case 'deriv': {
        if (!credentials.apiToken) {
          throw new Error('Deriv adapter requires apiToken in credentials');
        }
        return new DerivBrokerAdapter({
          appId: credentials.appId, // Falls back to DERIV_APP_ID if not set
          apiToken: credentials.apiToken,
          accountId: credentials.accountId,
        });
      }

      default:
        logger.warn(`Unknown broker type "${brokerType}", falling back to MT5`);
        return new MT5BrokerAdapter({
          baseUrl: credentials.baseUrl || defaultMt5BaseUrl || 'http://localhost:3030',
          login: credentials.login,
        });
    }
  }
}
