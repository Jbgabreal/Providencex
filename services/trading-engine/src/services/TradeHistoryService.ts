import { Logger } from '@providencex/shared-utils';
import { OrderEvent } from '@providencex/shared-types';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';

const logger = new Logger('TradeHistoryService');

/**
 * TradeHistoryService
 *
 * Handles trade history persistence from order events
 */
export class TradeHistoryService {
  constructor(private readonly tradeHistoryRepo: TradeHistoryRepository) {}

  /**
   * Process a position_closed event from OrderEventService
   */
  async processPositionClosed(event: OrderEvent): Promise<void> {
    if (event.event_type !== 'position_closed') {
      logger.warn(`[TradeHistoryService] Expected position_closed event, got: ${event.event_type}`);
      return;
    }

    if (!event.ticket) {
      logger.warn('[TradeHistoryService] Missing ticket in position_closed event');
      return;
    }

    try {
      const result = await this.tradeHistoryRepo.recordTradeClosed({
        mt5Ticket: typeof event.ticket === 'string' ? parseInt(event.ticket, 10) : event.ticket,
        exitPrice: event.exit_price || 0,
        profit: event.profit || 0,
        commission: event.commission || undefined,
        swap: event.swap || undefined,
        exitReason: event.reason || undefined,
      });

      if (result) {
        logger.info(`[TradeHistoryService] Recorded closed trade: ticket ${event.ticket}, profit ${event.profit || 0}`);
      } else {
        logger.warn(`[TradeHistoryService] No open trade found for ticket ${event.ticket} (may be legacy trade)`);
      }
    } catch (error) {
      logger.error(`[TradeHistoryService] Failed to record closed trade for ticket ${event.ticket}`, error);
      // Don't throw - just log
    }
  }
}

