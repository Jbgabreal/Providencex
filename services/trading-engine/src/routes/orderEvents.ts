/**
 * Order Events Webhook Route (Execution v3)
 * 
 * Receives order lifecycle events from MT5 Connector
 */

import { Router, Request, Response } from 'express';
import { Logger } from '@providencex/shared-utils';
import { OrderEvent } from '@providencex/shared-types';
import { OrderEventService } from '../services/OrderEventService';

const logger = new Logger('OrderEventsRoute');
const router: Router = Router();

let orderEventService: OrderEventService | null = null;

/**
 * Initialize order event service (called from server.ts)
 */
export function initializeOrderEventService(service: OrderEventService): void {
  orderEventService = service;
}

/**
 * POST /api/v1/order-events
 * Webhook endpoint for MT5 Connector to send order lifecycle events
 */
router.post('/', async (req: Request, res: Response) => {
  if (!orderEventService) {
    logger.warn('[OrderEventsRoute] OrderEventService not initialized');
    return res.status(503).json({
      success: false,
      error: 'OrderEventService not available',
    });
  }

  try {
    // Validate request body
    const event = req.body as OrderEvent;

    // Basic validation
    if (!event.source || event.source !== 'mt5-connector') {
      return res.status(400).json({
        success: false,
        error: 'Invalid event source',
      });
    }

    if (!event.event_type) {
      return res.status(400).json({
        success: false,
        error: 'Missing event_type',
      });
    }

    if (!event.timestamp) {
      return res.status(400).json({
        success: false,
        error: 'Missing timestamp',
      });
    }

    // Process event (async, fire and forget)
    orderEventService.processEvent(event).catch((error) => {
      logger.error('[OrderEventsRoute] Error processing event', error);
      // Don't throw - webhook should always return 200
    });

    // Always return 200 to MT5 Connector (acknowledge receipt)
    res.status(200).json({
      success: true,
      message: 'Event received',
    });

    logger.debug(`[OrderEventsRoute] Received event: ${event.event_type} for ticket ${event.ticket}`);
  } catch (error) {
    logger.error('[OrderEventsRoute] Error handling webhook request', error);
    // Still return 200 to prevent MT5 Connector from retrying
    res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

