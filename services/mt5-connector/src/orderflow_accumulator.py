"""
Order Flow Accumulator (MT5 Connector v14)
Maintains rolling 1-minute tick buffer for order flow calculations
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import deque
from .utils import logger
import MetaTrader5 as mt5


class TickData:
    """Single tick data point"""
    def __init__(self, symbol: str, bid: float, ask: float, volume: int, time: datetime):
        self.symbol = symbol
        self.bid = bid
        self.ask = ask
        self.volume = volume  # Tick volume
        self.time = time
        self.spread = ask - bid


class OrderFlowAccumulator:
    """Accumulates ticks and computes order flow metrics"""
    
    def __init__(self, lookback_seconds: int = 60):
        """
        Initialize accumulator with rolling window
        
        Args:
            lookback_seconds: How many seconds of ticks to keep (default: 60 = 1 minute)
        """
        self.lookback_seconds = lookback_seconds
        self.tick_buffers: Dict[str, deque] = {}  # Symbol -> deque of TickData
        self.large_order_multiplier = 20  # Default: 20x average tick volume = large order
    
    def add_tick(self, symbol: str, bid: float, ask: float, volume: int, time: Optional[datetime] = None):
        """Add a new tick to the buffer"""
        if time is None:
            time = datetime.now()
        
        if symbol not in self.tick_buffers:
            self.tick_buffers[symbol] = deque()
        
        tick = TickData(symbol, bid, ask, volume, time)
        self.tick_buffers[symbol].append(tick)
        
        # Remove ticks older than lookback window
        cutoff_time = time - timedelta(seconds=self.lookback_seconds)
        while self.tick_buffers[symbol] and self.tick_buffers[symbol][0].time < cutoff_time:
            self.tick_buffers[symbol].popleft()
    
    def compute_order_flow(self, symbol: str, window_seconds: Optional[int] = None) -> Optional[Dict]:
        """
        Compute order flow metrics for a symbol
        
        Args:
            symbol: Symbol to compute order flow for
            window_seconds: Optional window size (defaults to lookback_seconds)
        
        Returns:
            Dictionary with order flow metrics or None if insufficient data
        """
        if symbol not in self.tick_buffers:
            return None
        
        ticks = list(self.tick_buffers[symbol])
        if len(ticks) < 5:  # Need at least a few ticks
            return None
        
        window_seconds = window_seconds or self.lookback_seconds
        now = datetime.now()
        cutoff_time = now - timedelta(seconds=window_seconds)
        
        # Filter ticks within window
        recent_ticks = [t for t in ticks if t.time >= cutoff_time]
        if len(recent_ticks) == 0:
            return None
        
        # Compute bid/ask volumes (simplified: use tick volume as proxy)
        # In real order flow, we'd track actual market orders at bid/ask
        # For now, we estimate based on tick direction and volume
        
        bid_volume = 0.0
        ask_volume = 0.0
        
        # Estimate buy/sell volume from tick movement
        # If tick moves up (ask increases), more buying pressure
        # If tick moves down (bid decreases), more selling pressure
        for i in range(1, len(recent_ticks)):
            prev_tick = recent_ticks[i - 1]
            curr_tick = recent_ticks[i]
            
            # Mid price movement
            prev_mid = (prev_tick.bid + prev_tick.ask) / 2
            curr_mid = (curr_tick.bid + curr_tick.ask) / 2
            
            tick_volume = curr_tick.volume or 1  # Default to 1 if volume not available
            
            if curr_mid > prev_mid:
                # Price moved up - buying pressure
                ask_volume += tick_volume
            elif curr_mid < prev_mid:
                # Price moved down - selling pressure
                bid_volume += tick_volume
            else:
                # No movement - split volume
                bid_volume += tick_volume * 0.5
                ask_volume += tick_volume * 0.5
        
        # If no movement detected, use simple heuristic based on spread position
        if bid_volume == 0 and ask_volume == 0:
            # Estimate from current spread position (simplified)
            latest_tick = recent_ticks[-1]
            avg_volume = sum(t.volume or 1 for t in recent_ticks) / len(recent_ticks)
            bid_volume = avg_volume * 0.5
            ask_volume = avg_volume * 0.5
        
        # Compute delta
        total_volume = bid_volume + ask_volume
        delta = ask_volume - bid_volume  # Positive = buying pressure
        
        # Imbalance percentages
        imbalance_buy_pct = (ask_volume / total_volume * 100) if total_volume > 0 else 50.0
        imbalance_sell_pct = (bid_volume / total_volume * 100) if total_volume > 0 else 50.0
        
        # Determine delta sign
        if delta > 0:
            delta_sign = 'buying_pressure'
        elif delta < 0:
            delta_sign = 'selling_pressure'
        else:
            delta_sign = 'neutral'
        
        # Detect large orders (ticks with volume significantly above average)
        avg_tick_volume = sum(t.volume or 1 for t in recent_ticks) / len(recent_ticks)
        large_order_threshold = avg_tick_volume * self.large_order_multiplier
        
        large_orders = []
        for tick in recent_ticks:
            if tick.volume and tick.volume >= large_order_threshold:
                # Determine side based on price movement
                # Simplified: compare to previous tick
                side = 'buy' if tick.ask > tick.bid else 'sell'
                large_orders.append({
                    'volume': float(tick.volume),
                    'side': side,
                    'price': float(tick.ask if side == 'buy' else tick.bid)
                })
        
        return {
            'symbol': symbol,
            'timestamp': now.isoformat(),
            'bid_volume': round(bid_volume, 2),
            'ask_volume': round(ask_volume, 2),
            'delta': round(delta, 2),
            'delta_sign': delta_sign,
            'imbalance_buy_pct': round(imbalance_buy_pct, 1),
            'imbalance_sell_pct': round(imbalance_sell_pct, 1),
            'large_orders': large_orders,
            'tick_count': len(recent_ticks),
        }
    
    def clear_symbol(self, symbol: str):
        """Clear tick buffer for a symbol"""
        if symbol in self.tick_buffers:
            del self.tick_buffers[symbol]
    
    def clear_all(self):
        """Clear all tick buffers"""
        self.tick_buffers.clear()


# Global accumulator instance
_global_accumulator: Optional[OrderFlowAccumulator] = None


def get_accumulator() -> OrderFlowAccumulator:
    """Get or create global accumulator instance"""
    global _global_accumulator
    if _global_accumulator is None:
        _global_accumulator = OrderFlowAccumulator(lookback_seconds=60)
        logger.info("OrderFlowAccumulator initialized (60s lookback)")
    return _global_accumulator

