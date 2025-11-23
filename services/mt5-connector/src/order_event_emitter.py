"""
Order Event Emitter (Execution v3)
Emits order lifecycle events to Trading Engine webhook
"""
import asyncio
import aiohttp
from typing import Dict, Any, Optional
from datetime import datetime
from .config import MT5Config
from .utils import logger


class OrderEventEmitter:
    """Emits order lifecycle events to Trading Engine webhook"""
    
    def __init__(self, config: MT5Config):
        self.config = config
        self.webhook_url = config.trading_engine_order_webhook_url
        self.enabled = bool(self.webhook_url and self.webhook_url.strip())
        self.session: Optional[aiohttp.ClientSession] = None
        
        if self.enabled:
            logger.info(f"[OrderEventEmitter] Enabled. Webhook URL: {self.webhook_url}")
        else:
            logger.warning("[OrderEventEmitter] Disabled. TRADING_ENGINE_ORDER_WEBHOOK_URL not configured")
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session"""
        if self.session is None or self.session.closed:
            timeout = aiohttp.ClientTimeout(total=5)  # 5 second timeout
            self.session = aiohttp.ClientSession(timeout=timeout)
        return self.session
    
    async def _emit_event(self, event: Dict[str, Any], retry_count: int = 3) -> bool:
        """
        Emit an order event to the webhook with retry logic
        
        Args:
            event: Event payload dictionary
            retry_count: Number of retry attempts (default: 3)
        
        Returns:
            True if successful, False otherwise
        """
        if not self.enabled:
            return False
        
        if not self.webhook_url:
            return False
        
        session = await self._get_session()
        
        for attempt in range(retry_count):
            try:
                async with session.post(self.webhook_url, json=event) as response:
                    if response.status == 200:
                        logger.debug(f"[OrderEventEmitter] Event emitted successfully: {event.get('event_type')}")
                        return True
                    else:
                        text = await response.text()
                        logger.warning(
                            f"[OrderEventEmitter] Webhook returned {response.status}: {text} "
                            f"(attempt {attempt + 1}/{retry_count})"
                        )
                        if attempt < retry_count - 1:
                            # Exponential backoff: 1s, 2s, 4s
                            await asyncio.sleep(2 ** attempt)
            except asyncio.TimeoutError:
                logger.warning(
                    f"[OrderEventEmitter] Webhook request timeout (attempt {attempt + 1}/{retry_count})"
                )
                if attempt < retry_count - 1:
                    await asyncio.sleep(2 ** attempt)
            except Exception as e:
                logger.error(
                    f"[OrderEventEmitter] Error emitting event: {e} (attempt {attempt + 1}/{retry_count})"
                )
                if attempt < retry_count - 1:
                    await asyncio.sleep(2 ** attempt)
        
        logger.error(f"[OrderEventEmitter] Failed to emit event after {retry_count} attempts: {event.get('event_type')}")
        return False
    
    async def emit_order_sent(self, ticket: int, symbol: str, direction: str, volume: float, **kwargs) -> bool:
        """Emit order_sent event"""
        event = {
            "source": "mt5-connector",
            "event_type": "order_sent",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": ticket,
            "symbol": symbol,
            "direction": direction.lower(),
            "volume": volume,
            **kwargs,
        }
        return await self._emit_event(event)
    
    async def emit_order_rejected(self, ticket: int, symbol: str, reason: str, **kwargs) -> bool:
        """Emit order_rejected event"""
        event = {
            "source": "mt5-connector",
            "event_type": "order_rejected",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": ticket,
            "symbol": symbol,
            "reason": reason,
            **kwargs,
        }
        return await self._emit_event(event)
    
    async def emit_position_opened(self, position: Dict[str, Any]) -> bool:
        """Emit position_opened event"""
        from datetime import datetime
        
        open_time = position.get('open_time')
        if isinstance(open_time, str):
            open_time_dt = open_time
        elif hasattr(open_time, 'timestamp'):
            open_time_dt = datetime.fromtimestamp(open_time.timestamp()).isoformat() + "Z"
        else:
            open_time_dt = datetime.utcnow().isoformat() + "Z"
        
        event = {
            "source": "mt5-connector",
            "event_type": "position_opened",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": position.get('ticket'),
            "position_id": position.get('position_id') or position.get('ticket'),
            "symbol": position.get('symbol'),
            "direction": position.get('direction', '').lower(),
            "volume": position.get('volume'),
            "entry_time": open_time_dt,
            "entry_price": position.get('open_price') or position.get('entry_price'),
            "sl_price": position.get('sl') or position.get('sl_price'),
            "tp_price": position.get('tp') or position.get('tp_price'),
            "magic_number": position.get('magic', 123456),
            "comment": position.get('comment', 'ProvidenceX'),
        }
        return await self._emit_event(event)
    
    async def emit_position_closed(self, position: Dict[str, Any], deal: Dict[str, Any]) -> bool:
        """Emit position_closed event (for v7 PnL tracking)"""
        from datetime import datetime
        
        entry_time = position.get('time_open')
        if isinstance(entry_time, (int, float)):
            entry_time_dt = datetime.fromtimestamp(entry_time).isoformat() + "Z"
        elif isinstance(entry_time, str):
            entry_time_dt = entry_time
        else:
            entry_time_dt = datetime.utcnow().isoformat() + "Z"
        
        exit_time = deal.get('time')
        if isinstance(exit_time, (int, float)):
            exit_time_dt = datetime.fromtimestamp(exit_time).isoformat() + "Z"
        elif isinstance(exit_time, str):
            exit_time_dt = exit_time
        else:
            exit_time_dt = datetime.utcnow().isoformat() + "Z"
        
        # Determine close reason
        reason = "unknown"
        if deal.get('reason') == 3:  # TP hit
            reason = "tp"
        elif deal.get('reason') == 4:  # SL hit
            reason = "sl"
        elif deal.get('entry') == 1:  # Manual close
            reason = "manual"
        
        event = {
            "source": "mt5-connector",
            "event_type": "position_closed",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": position.get('ticket') or deal.get('position'),
            "position_id": position.get('identifier') or deal.get('position'),
            "symbol": position.get('symbol') or deal.get('symbol'),
            "direction": ('buy' if position.get('type') == 0 else 'sell') if position.get('type') is not None else None,
            "volume": deal.get('volume') or position.get('volume'),
            "entry_time": entry_time_dt,
            "exit_time": exit_time_dt,
            "entry_price": deal.get('price_open') or position.get('price_open'),
            "exit_price": deal.get('price'),
            "sl_price": position.get('sl'),
            "tp_price": position.get('tp'),
            "commission": deal.get('commission', 0),
            "swap": deal.get('storage', 0),
            "profit": deal.get('profit', 0),
            "reason": reason,
            "magic_number": position.get('magic', 123456),
            "comment": position.get('comment', 'ProvidenceX'),
            "raw": {
                "deal": {k: v for k, v in deal.items() if not k.startswith('_')} if hasattr(deal, '__dict__') else deal,
                "position": {k: v for k, v in position.items() if not k.startswith('_')} if hasattr(position, '__dict__') else position,
            },
        }
        return await self._emit_event(event)
    
    async def emit_position_modified(self, position_data: Dict[str, Any]) -> bool:
        """Emit position_modified event (SL/TP modified)"""
        event = {
            "source": "mt5-connector",
            "event_type": position_data.get('event_type', 'position_modified'),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": position_data.get('ticket'),
            "symbol": position_data.get('symbol'),
            "direction": position_data.get('direction', '').lower(),
            "sl_price": position_data.get('sl_price'),
            "tp_price": position_data.get('tp_price'),
            "comment": "SL/TP modified",
        }
        return await self._emit_event(event)
    
    async def emit_partial_close(self, position_data: Dict[str, Any]) -> bool:
        """Emit partial_close event"""
        event = {
            "source": "mt5-connector",
            "event_type": "partial_close",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "ticket": position_data.get('ticket'),
            "symbol": position_data.get('symbol'),
            "direction": position_data.get('direction', '').lower(),
            "volume": position_data.get('volume_closed'),
            "comment": f"Partial close {position_data.get('volume_percent')}%",
        }
        return await self._emit_event(event)
    
    async def close(self):
        """Close the aiohttp session"""
        if self.session and not self.session.closed:
            await self.session.close()
            self.session = None

