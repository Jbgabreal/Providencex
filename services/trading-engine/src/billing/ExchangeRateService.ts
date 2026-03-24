/**
 * ExchangeRateService — Fetches and snapshots crypto exchange rates.
 * For USDT/USDC (stablecoins), rate is ~1.0 vs USD.
 * Abstraction allows swapping to real API (CoinGecko, Binance) later.
 */

import { Logger } from '@providencex/shared-utils';
import { BillingRepository } from './BillingRepository';
import type { ExchangeRateSnapshot, PaymentRail, SUPPORTED_RAILS } from './types';

const logger = new Logger('ExchangeRateService');

// Stablecoin rates — hardcoded at 1:1 for v1 since USDT/USDC peg to USD
const STABLECOIN_RATES: Record<string, number> = {
  USDT: 1.0,
  USDC: 1.0,
};

export class ExchangeRateService {
  constructor(private repo: BillingRepository) {}

  /**
   * Get the current rate for a token and snapshot it for an invoice.
   * For stablecoins, this is effectively 1:1 with USD.
   * Returns the snapshot record.
   */
  async snapshotRate(token: string, fiatCurrency = 'USD'): Promise<ExchangeRateSnapshot> {
    const rate = await this.fetchRate(token, fiatCurrency);
    const snapshot = await this.repo.createExchangeRateSnapshot({
      fiatCurrency,
      cryptoToken: token,
      rate,
      source: 'stablecoin_peg',  // Change to 'coingecko' or 'binance' when adding real API
    });
    logger.info(`[ExchangeRate] Snapshot: 1 ${fiatCurrency} = ${rate} ${token}`);
    return snapshot;
  }

  /**
   * Calculate expected crypto amount from fiat amount using current rate.
   */
  async calculateCryptoAmount(amountFiat: number, token: string, fiatCurrency = 'USD'): Promise<{
    amountCrypto: number;
    rate: number;
    snapshot: ExchangeRateSnapshot;
  }> {
    const snapshot = await this.snapshotRate(token, fiatCurrency);
    const rate = Number(snapshot.rate);
    // amount_crypto = amount_fiat * rate (for stablecoins, rate ≈ 1.0)
    const amountCrypto = Math.round(amountFiat * rate * 100) / 100; // Round to 2 decimals for stablecoins
    return { amountCrypto, rate, snapshot };
  }

  private async fetchRate(token: string, fiatCurrency: string): Promise<number> {
    // v1: Use hardcoded stablecoin rates
    // TODO: Integrate CoinGecko/Binance API for real-time rates
    const rate = STABLECOIN_RATES[token];
    if (!rate) {
      throw new Error(`Unsupported token for exchange rate: ${token}`);
    }
    return rate;
  }
}
