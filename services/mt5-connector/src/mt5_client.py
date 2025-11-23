"""
MT5 Client - Encapsulates MetaTrader5 library functions
Manages connection, initialization, and trade execution
"""
import MetaTrader5 as mt5
from typing import Optional, Dict, Any, Tuple
from .config import MT5Config
from .utils import logger, log_mt5_error, log_trade_success, log_mt5_connection


class MT5Client:
    """Client for interacting with MetaTrader 5"""
    
    def __init__(self, config: MT5Config):
        self.config = config
        self._initialized = False
        self._connected = False
    
    def initialize(self) -> Tuple[bool, str]:
        """
        Initialize MT5 connection
        Returns: (success, message)
        """
        try:
            # Shutdown any existing connection first
            if self._initialized:
                self.shutdown()
            
            # Initialize MT5 - try with path first, then auto-detect if path doesn't exist
            initialized = False
            
            if self.config.path:
                from pathlib import Path
                mt5_path = Path(self.config.path)
                if mt5_path.exists():
                    logger.info(f"Initializing MT5 with specified path: {self.config.path}")
                    initialized = mt5.initialize(path=str(mt5_path))
                else:
                    logger.warning(f"⚠️  MT5_PATH file does not exist: {self.config.path}")
                    logger.warning("   Trying auto-detect instead...")
                    initialized = mt5.initialize()  # Auto-detect
            else:
                logger.info("Initializing MT5 without path (auto-detect)...")
                initialized = mt5.initialize()
            
            if not initialized:
                error_code, error_desc = mt5.last_error()
                
                # Common MT5 error codes:
                # -10003: Terminal path invalid or terminal not found
                # -10002: Terminal not authorized
                # -10001: Terminal not installed
                error_messages = {
                    -10003: f"Terminal path invalid or terminal not found. Check MT5_PATH in .env file.",
                    -10002: "Terminal not authorized. Make sure MT5 terminal is properly installed.",
                    -10001: "Terminal not installed. Install MetaTrader 5 or set correct MT5_PATH.",
                }
                
                error_hint = error_messages.get(error_code, "")
                error_msg = f"MT5 initialize() failed: {error_code} - {error_desc}"
                if error_hint:
                    error_msg += f"\n💡 {error_hint}"
                
                logger.error(error_msg)
                log_mt5_connection(False, error_msg)
                return False, error_msg
            
            self._initialized = True
            
            # Login if credentials provided
            if self.config.validate():
                login_result = self._login()
                if not login_result[0]:
                    self.shutdown()
                    return False, login_result[1]
                self._connected = True
                log_mt5_connection(True, f"Logged in to account {self.config.login} on {self.config.server}")
            else:
                self._connected = True  # If no credentials, assume demo/auto-login
                log_mt5_connection(True, "Connected (no login required)")
            
            return True, "MT5 initialized successfully"
        
        except Exception as e:
            error_msg = f"Exception during MT5 initialization: {str(e)}"
            logger.exception(error_msg)
            return False, error_msg
    
    def _login(self) -> Tuple[bool, str]:
        """Internal method to login to MT5 account"""
        try:
            authorized = mt5.login(
                login=self.config.login,
                password=self.config.password,
                server=self.config.server
            )
            
            if not authorized:
                error_code, error_desc = mt5.last_error()
                error_msg = f"MT5 login failed: {error_code} - {error_desc}"
                log_mt5_error("login", error_code, error_desc)
                return False, error_msg
            
            return True, "Login successful"
        
        except Exception as e:
            error_msg = f"Exception during MT5 login: {str(e)}"
            logger.exception(error_msg)
            return False, error_msg
    
    def ensure_initialized(self) -> Tuple[bool, str]:
        """
        Ensure MT5 is initialized and connected
        Returns: (success, message)
        """
        if self._initialized and self._connected:
            # Verify connection is still alive
            try:
                account_info = mt5.account_info()
                if account_info is None:
                    # Connection lost, reinitialize
                    logger.warning("MT5 connection lost, reinitializing...")
                    return self.initialize()
                
                # Log account info for debugging
                logger.debug(f"MT5 Account Info: Login={account_info.login}, Server={account_info.server}, "
                           f"Balance={account_info.balance}, TradeAllowed={account_info.trade_allowed}, "
                           f"TradeExpert={account_info.trade_expert}")
                
                return True, "Already connected"
            except Exception as e:
                logger.warning(f"Error checking MT5 connection: {e}, reinitializing...")
                return self.initialize()
        
        return self.initialize()
    
    def shutdown(self) -> None:
        """Shutdown MT5 connection"""
        try:
            if self._initialized:
                mt5.shutdown()
                self._initialized = False
                self._connected = False
                logger.info("MT5 connection shutdown")
        except Exception as e:
            logger.error(f"Error during MT5 shutdown: {e}")
    
    def is_connected(self) -> bool:
        """Check if MT5 is currently connected"""
        try:
            if not self._initialized or not self._connected:
                return False
            account_info = mt5.account_info()
            return account_info is not None
        except Exception:
            return False
    
    def validate_symbol(self, symbol: str) -> Tuple[bool, str, str]:
        """
        Validate that a symbol exists in MT5
        Automatically tries:
        1. Symbol as-is
        2. Common broker aliases (e.g., XAUUSD -> GOLD for some brokers)
        3. Common broker suffixes (.0, .1, .conv, etc.)
        
        Returns: (valid, actual_symbol_name, message)
        """
        try:
            # Common symbol aliases (broker-specific mappings)
            symbol_aliases = {
                'XAUUSD': ['GOLD', 'XAUUSD', 'XAU/USD'],  # Gold - try GOLD first for XM Global
                'XAGUSD': ['SILVER', 'XAGUSD', 'XAG/USD'],  # Silver
                'BTCUSD': ['BTCUSD', 'BTC/USD'],
                'US30': ['US30', 'US30Cash', 'DOW', 'DJI'],
                'SPX500': ['SPX500', 'SP500', 'US500'],
                'NAS100': ['NAS100', 'NASDAQ', 'US100'],
            }
            
            # Build list of symbols to try
            symbols_to_try = [symbol.upper()]  # Try original first
            
            # Add aliases if available
            if symbol.upper() in symbol_aliases:
                symbols_to_try.extend(symbol_aliases[symbol.upper()])
            
            # Try each symbol variant
            for symbol_variant in symbols_to_try:
                # First, try the symbol as-is
                symbol_info = mt5.symbol_info(symbol_variant)
                if symbol_info is not None:
                    if not symbol_info.visible:
                        # Try to enable the symbol
                        if not mt5.symbol_select(symbol_variant, True):
                            continue  # Try next variant
                    if symbol_variant != symbol.upper():
                        logger.info(f"Symbol {symbol} mapped to {symbol_variant} (broker alias)")
                    return True, symbol_variant, "Symbol valid"
            
            # Symbol not found, try common broker suffixes on original symbol
            common_suffixes = ['.0', '.1', '.conv', '.raw', '.pro']
            for suffix in common_suffixes:
                symbol_with_suffix = symbol.upper() + suffix
                symbol_info = mt5.symbol_info(symbol_with_suffix)
                if symbol_info is not None:
                    # Found a match with suffix
                    if not symbol_info.visible:
                        if not mt5.symbol_select(symbol_with_suffix, True):
                            continue  # Try next suffix
                    logger.info(f"Symbol {symbol} mapped to {symbol_with_suffix} (broker uses suffix)")
                    return True, symbol_with_suffix, f"Symbol mapped to {symbol_with_suffix}"
            
            # Still not found, check if account is logged in
            account_info = mt5.account_info()
            if account_info is None:
                return False, symbol, f"Symbol {symbol} not found. Make sure MT5 terminal is logged into an account."
            
            # Try to get list of available symbols to suggest alternatives
            symbols = mt5.symbols_get()
            if symbols:
                # Look for similar symbol names (exact prefix match)
                similar = [s.name for s in symbols if s.name.startswith(symbol.upper()) or symbol.upper() in s.name]
                if similar:
                    # Sort by exact prefix match first
                    similar.sort(key=lambda x: 0 if x.startswith(symbol.upper()) else 1)
                    return False, symbol, f"Symbol {symbol} not found. Available similar symbols: {', '.join(similar[:5])}. Use one of these exact symbol names."
            
            return False, symbol, f"Symbol {symbol} not found. Make sure the symbol is enabled in MT5 Market Watch."
        except Exception as e:
            return False, symbol, f"Error validating symbol: {str(e)}"
    
    def _make_error_response(
        self,
        error_code: int,
        error_message: str,
        *,
        symbol: str | None = None,
        direction: str | None = None,
        order_kind: str | None = None,
        volume: float | None = None,
    ) -> Dict[str, Any]:
        """
        Create a standardized error response for MT5 API
        
        Args:
            error_code: Numeric error code (MT5 error code if available, otherwise local code)
            error_message: Human-readable error message
            symbol: Symbol name (if available)
            direction: Trade direction (if available)
            order_kind: Order kind (if available)
            volume: Requested volume (if available)
        
        Returns:
            Standardized error response dictionary
        """
        return {
            "success": False,
            "error_code": error_code,
            "error_message": error_message,
            "context": {
                "symbol": symbol,
                "direction": direction,
                "order_kind": order_kind,
                "volume": volume,
            },
        }
    
    def _make_success_response(
        self,
        ticket: int,
        *,
        symbol: str,
        volume: float,
        price: float,
        direction: str,
        order_kind: str,
    ) -> Dict[str, Any]:
        """
        Create a standardized success response for MT5 API
        
        Args:
            ticket: MT5 order ticket number
            symbol: Symbol name used (broker symbol, e.g. GOLD if XAUUSD mapped)
            volume: Normalized volume used on the order
            price: Entry price of the executed trade
            direction: Trade direction ("buy" or "sell")
            order_kind: Order kind ("market" or "pending")
        
        Returns:
            Standardized success response dictionary
        """
        return {
            "success": True,
            "ticket": ticket,
            "symbol": symbol,
            "volume": volume,
            "price": price,
            "direction": direction,
            "order_kind": order_kind,
        }
    
    def get_price(self, symbol: str) -> Dict[str, Any]:
        """
        Get current price tick for a symbol
        
        Args:
            symbol: Trading symbol (e.g., 'XAUUSD', 'EURUSD')
        
        Returns:
            Dictionary with 'success', 'symbol', 'resolved_symbol', 'bid', 'ask', 'last', 'time', 'time_iso'
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return self._make_error_response(
                error_code=-10001,  # Local error code for connection failure
                error_message=f"MT5 connection failed: {init_msg}",
                symbol=symbol,
            )
        
        # Validate and resolve symbol (handles aliases and suffixes)
        symbol_valid, resolved_symbol, symbol_msg = self.validate_symbol(symbol)
        if not symbol_valid:
            return self._make_error_response(
                error_code=-10002,  # Local error code for invalid symbol
                error_message=symbol_msg,
                symbol=symbol,
            )
        
        try:
            # Get current tick
            tick = mt5.symbol_info_tick(resolved_symbol)
            
            if tick is None:
                error_code, error_desc = mt5.last_error()
                return {
                    'success': False,
                    'error': f"Could not get tick data for {resolved_symbol}: {error_code} - {error_desc}"
                }
            
            # Convert MT5 time to ISO format
            from datetime import datetime
            tick_time = datetime.fromtimestamp(tick.time) if tick.time else datetime.now()
            time_iso = tick_time.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            # Calculate mid price
            mid = (tick.bid + tick.ask) / 2.0 if tick.bid > 0 and tick.ask > 0 else tick.last
            
            return {
                'success': True,
                'symbol': symbol.upper(),
                'resolved_symbol': resolved_symbol,
                'bid': tick.bid,
                'ask': tick.ask,
                'last': tick.last,
                'mid': mid,
                'time': tick.time,
                'time_iso': time_iso
            }
        
        except Exception as e:
            logger.exception(f"Exception getting price for {symbol}")
            return {
                'success': False,
                'error': f"Error getting price for {symbol}: {str(e)}"
            }
    
    def open_trade(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Open a trade in MT5 (market, limit, or stop order)
        
        Args:
            request: Dictionary with keys: symbol, direction, order_kind, lot_size, entry_price (for pending),
                    stop_loss, take_profit, strategy
        
        Returns:
            Dictionary with 'success', 'ticket' (if successful), or 'error' (if failed)
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return {
                'success': False,
                'error': f"MT5 connection failed: {init_msg}"
            }
        
        symbol = request['symbol']
        direction = request['direction']
        order_kind = request.get('order_kind', 'market').lower()  # Default to market for backward compatibility
        lot_size = request['lot_size']
        entry_price = request.get('entry_price')  # May be None for market orders
        # Support both stop_loss/stop_loss_price and take_profit/take_profit_price
        stop_loss = request.get('stop_loss') or request.get('stop_loss_price')
        take_profit = request.get('take_profit') or request.get('take_profit_price')
        strategy = request.get('strategy', 'unknown')
        
        # Validate symbol (returns actual symbol name if mapped to suffix version)
        symbol_valid, actual_symbol, symbol_msg = self.validate_symbol(symbol)
        if not symbol_valid:
            log_mt5_error("validate_symbol", 0, symbol_msg, {'symbol': symbol})
            return self._make_error_response(
                error_code=-10002,  # Local error code for invalid symbol
                error_message=symbol_msg,
                symbol=symbol,
                direction=direction,
                order_kind=order_kind,
                volume=lot_size,
            )
        
        # Use the actual symbol name (might have suffix like .0 or .conv)
        if actual_symbol != symbol:
            logger.info(f"Symbol automatically mapped: {symbol} -> {actual_symbol} (broker uses suffix)")
        symbol = actual_symbol
        
        try:
            # Get current market tick (needed for market orders and pending order validation)
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                error_code, error_desc = mt5.last_error()
                log_mt5_error("symbol_info_tick", error_code, error_desc, {'symbol': symbol})
                return self._make_error_response(
                    error_code=error_code if error_code else -10003,
                    error_message=f"Failed to get market price for {symbol}: {error_code} - {error_desc}",
                    symbol=symbol,
                    direction=direction,
                    order_kind=order_kind,
                    volume=lot_size,
                )
            
            current_bid = tick.bid
            current_ask = tick.ask
            
            # Get symbol info (needed for volume normalization, filling mode, and stop distance)
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                error_code, error_desc = mt5.last_error()
                error_msg = f"Could not get symbol info for {symbol}: {error_code} - {error_desc}"
                logger.error(error_msg)
                log_mt5_error("symbol_info", error_code, error_desc, {'symbol': symbol})
                return {
                    'success': False,
                    'error': error_msg
                }
            
            # Branch based on order_kind
            if order_kind == 'market':
                # MARKET ORDER: Use live Bid/Ask prices
                if direction.lower() == "buy":
                    mt5_order_type = mt5.ORDER_TYPE_BUY
                    entry_price_used = current_ask
                    action = mt5.TRADE_ACTION_DEAL  # Market execution
                else:  # sell
                    mt5_order_type = mt5.ORDER_TYPE_SELL
                    entry_price_used = current_bid
                    action = mt5.TRADE_ACTION_DEAL  # Market execution
                
                logger.info(
                    f"[ORDER_KIND=market] {symbol}: direction={direction}, "
                    f"entry_price={entry_price_used} (live), "
                    f"current_bid={current_bid}, current_ask={current_ask}"
                )
            
            elif order_kind in ('limit', 'stop'):
                # PENDING ORDER: Use entry_price and map to appropriate MT5 order type
                if entry_price is None or entry_price <= 0:
                    return {
                        'success': False,
                        'error': f'entry_price is required for {order_kind} orders'
                    }
                
                # Determine MT5 order type based on direction and order_kind
                if direction.lower() == "buy":
                    if order_kind == 'limit':
                        # BUY_LIMIT: Price must be below current ask
                        if entry_price >= current_ask:
                            return {
                                'success': False,
                                'error': f'Invalid pending order: BUY_LIMIT must have price < current ask ({current_ask})'
                            }
                        mt5_order_type = mt5.ORDER_TYPE_BUY_LIMIT
                    else:  # stop
                        # BUY_STOP: Price must be above current ask
                        if entry_price <= current_ask:
                            return {
                                'success': False,
                                'error': f'Invalid pending order: BUY_STOP must have price > current ask ({current_ask})'
                            }
                        mt5_order_type = mt5.ORDER_TYPE_BUY_STOP
                else:  # sell
                    if order_kind == 'limit':
                        # SELL_LIMIT: Price must be above current bid
                        if entry_price <= current_bid:
                            return {
                                'success': False,
                                'error': f'Invalid pending order: SELL_LIMIT must have price > current bid ({current_bid})'
                            }
                        mt5_order_type = mt5.ORDER_TYPE_SELL_LIMIT
                    else:  # stop
                        # SELL_STOP: Price must be below current bid
                        if entry_price >= current_bid:
                            return {
                                'success': False,
                                'error': f'Invalid pending order: SELL_STOP must have price < current bid ({current_bid})'
                            }
                        mt5_order_type = mt5.ORDER_TYPE_SELL_STOP
                
                entry_price_used = entry_price
                action = mt5.TRADE_ACTION_PENDING  # Pending order
                
                logger.info(
                    f"[ORDER_KIND={order_kind}] {symbol}: direction={direction}, "
                    f"entry_price={entry_price_used} (pending), "
                    f"current_bid={current_bid}, current_ask={current_ask}"
                )
            
            else:
                return self._make_error_response(
                    error_code=-10007,  # Local error code for invalid order kind
                    error_message=f'Invalid order_kind: {order_kind}. Must be "market", "limit", or "stop"',
                    symbol=symbol,
                    direction=direction,
                    order_kind=order_kind,
                    volume=lot_size,
                )
            
            # Get symbol info (needed for volume normalization and filling mode)
            symbol_info = mt5.symbol_info(symbol)
            
            if symbol_info is None:
                error_code, error_desc = mt5.last_error()
                error_msg = f"Could not get symbol info for {symbol}: {error_code} - {error_desc}"
                logger.error(error_msg)
                log_mt5_error("symbol_info", error_code, error_desc, {'symbol': symbol})
                return {
                    'success': False,
                    'error': error_msg
                }
            
            # Log symbol info for debugging
            logger.debug(f"Symbol {symbol} info: TradeMode={symbol_info.trade_mode}, "
                       f"FillingMode={symbol_info.filling_mode}, Visible={symbol_info.visible}, "
                       f"Select={symbol_info.select}")
            
            # Normalize volume according to broker constraints
            original_volume = lot_size
            normalized_volume = self._normalize_volume(original_volume, symbol_info)
            
            # Log volume normalization
            logger.info(
                f"Volume normalization for {symbol}: "
                f"requested={original_volume}, normalized={normalized_volume}, "
                f"min={symbol_info.volume_min}, max={symbol_info.volume_max}, step={symbol_info.volume_step}"
            )
            
            # Use normalized volume going forward
            lot_size = normalized_volume
            
            # Handle SL/TP based on order kind
            if order_kind == 'market':
                # Market orders: Re-enable safe SL/TP handling
                point = symbol_info.point
                min_stop_distance = (symbol_info.trade_stops_level if hasattr(symbol_info, 'trade_stops_level') and symbol_info.trade_stops_level else 0) * point
                
                # Check if SL/TP are provided
                if stop_loss is None and take_profit is None:
                    # No SL/TP requested - send naked market order
                    adjusted_sl = None
                    adjusted_tp = None
                    logger.info(
                        f"[ORDER_KIND=market] {symbol}: No SL/TP requested, sending naked market order"
                    )
                else:
                    # At least one SL/TP is provided - adjust using helper
                    adjusted_sl, adjusted_tp = self._adjust_stop_loss_take_profit(
                        symbol_info, entry_price_used, stop_loss, take_profit, direction
                    )
                    
                    logger.info(
                        f"[ORDER_KIND=market] {symbol}: direction={direction}, entry_price={entry_price_used}, "
                        f"min_stop_dist={min_stop_distance}, sl={adjusted_sl}, tp={adjusted_tp}"
                    )
            else:
                # Pending orders: Apply SL/TP if provided (same logic as market orders)
                if stop_loss is None and take_profit is None:
                    # No SL/TP requested - send naked pending order
                    adjusted_sl = None
                    adjusted_tp = None
                    logger.info(
                        f"[ORDER_KIND={order_kind}] {symbol}: No SL/TP requested, sending naked pending order"
                    )
                else:
                    # At least one SL/TP is provided - adjust using helper
                    adjusted_sl, adjusted_tp = self._adjust_stop_loss_take_profit(
                        symbol_info, entry_price_used, stop_loss, take_profit, direction
                    )
                    
                    point = symbol_info.point
                    min_stop_distance = (symbol_info.trade_stops_level if hasattr(symbol_info, 'trade_stops_level') and symbol_info.trade_stops_level else 0) * point
                    
                    logger.info(
                        f"[ORDER_KIND={order_kind}] {symbol}: direction={direction}, entry_price={entry_price_used}, "
                        f"min_stop_dist={min_stop_distance}, sl={adjusted_sl}, tp={adjusted_tp}"
                    )
            
            # Get filling modes (only for market orders; pending orders don't use filling modes)
            filling_modes_to_try = []
            if action == mt5.TRADE_ACTION_DEAL:
                # Market orders need filling modes
                filling_modes_to_try = self._get_filling_modes(symbol, symbol_info)
                reported_modes = symbol_info.filling_mode if symbol_info else 0
                logger.info(f"Symbol {symbol} filling modes: reported={reported_modes} (bitmask), trying={filling_modes_to_try}")
            else:
                # Pending orders don't use filling modes, use 0 or RETURN as default
                filling_modes_to_try = [mt5.ORDER_FILLING_RETURN]
                logger.info(f"Pending order: using default filling mode RETURN")
            
            # Try sending order (with retry for invalid stops)
            last_error = None
            tried_modes = []
            retry_without_stops = False
            all_fallback_modes = [mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK]
            has_tried_fallback = False
            
            # Retry logic: both market and pending orders support SL/TP
            # If MT5 returns INVALID_STOPS (10016), we retry once without SL/TP
            # Market orders use live prices, pending orders use entry_price for SL/TP adjustment
            max_attempts = 2  # Allow one retry without stops if INVALID_STOPS occurs
            
            for attempt in range(max_attempts):
                if attempt > 0 and order_kind != 'market':
                    # Second attempt: retry without stops (only for pending orders)
                    logger.warning(f"[RETRY_NO_STOPS] {symbol}: retrying pending order with sl=0.0, tp=0.0 due to invalid stops error")
                    adjusted_sl = 0.0
                    adjusted_tp = 0.0
                    retry_without_stops = True
                elif attempt > 0 and order_kind == 'market':
                    # Should not happen for market orders (already sl=0, tp=0), but handle gracefully
                    logger.warning(f"[RETRY_NO_STOPS] {symbol}: retrying market order with sl=0.0, tp=0.0")
                    adjusted_sl = 0.0
                    adjusted_tp = 0.0
                    retry_without_stops = True
                
                # Keep track of modes to try: start with reported modes, add fallback if all fail
                modes_list = list(filling_modes_to_try)
                modes_index = 0
                
                while modes_index < len(modes_list):
                    filling_mode = modes_list[modes_index]
                    
                    # Increment index now (before processing) so fallback check works correctly
                    modes_index += 1
                    
                    if action == mt5.TRADE_ACTION_DEAL:
                        mode_name = {
                            1: "RETURN",
                            2: "IOC",
                            4: "FOK"
                        }.get(filling_mode, f"UNKNOWN({filling_mode})")
                        logger.info(f"Trying filling mode: {mode_name} ({filling_mode}) for {symbol}")
                        tried_modes.append(f"{mode_name}({filling_mode})")
                    else:
                        logger.info(f"Sending pending order: {mt5_order_type}")
                    
                    # Build trade request
                    # Map adjusted_sl/adjusted_tp (None or float) to MT5 request values (0.0 or float)
                    trade_sl = adjusted_sl if adjusted_sl is not None else 0.0
                    trade_tp = adjusted_tp if adjusted_tp is not None else 0.0
                    
                    trade_request = {
                        "action": action,
                        "symbol": symbol,
                        "volume": lot_size,
                        "type": mt5_order_type,
                        "price": entry_price_used,
                        "sl": trade_sl,
                        "tp": trade_tp,
                        "magic": 123456,  # Magic number for ProvidenceX
                        "comment": f"ProvidenceX-{strategy}",
                        "type_time": mt5.ORDER_TIME_GTC,  # Good till cancelled
                    }
                    
                    # Add filling mode only for market orders
                    if action == mt5.TRADE_ACTION_DEAL:
                        trade_request["deviation"] = 20  # Maximum price deviation in points (market orders only)
                        trade_request["type_filling"] = filling_mode
                    # For pending orders, price is already set above (entry_price_used)
                
                    # Send order
                    result = mt5.order_send(trade_request)
                    
                    if result is None:
                        error_code, error_desc = mt5.last_error()
                        if action == mt5.TRADE_ACTION_DEAL:
                            last_error = f"OrderSend failed: {error_desc} (code: {error_code}, filling_mode: {filling_mode})"
                            logger.debug(f"Filling mode {filling_mode} failed, trying next...")
                            continue  # Try next filling mode (will check modes_index in while loop)
                        else:
                            last_error = f"OrderSend failed: {error_desc} (code: {error_code})"
                            break  # Don't retry filling modes for pending orders
                    
                    # Check result
                    if result.retcode == mt5.TRADE_RETCODE_DONE:
                        # Success!
                        ticket = result.order
                        log_trade_success("open_trade", ticket, {
                            'symbol': symbol,
                            'direction': direction,
                            'order_kind': order_kind,
                            'lot_size': lot_size,
                            'entry_price': entry_price_used,
                            'stop_loss': trade_sl,
                            'take_profit': trade_tp,
                            'strategy': strategy,
                            'filling_mode': filling_mode if action == mt5.TRADE_ACTION_DEAL else None,
                            'retry_without_stops': retry_without_stops,
                        })
                        
                        # Return structured success response with full context
                        return self._make_success_response(
                            ticket=ticket,
                            symbol=actual_symbol,  # Use broker symbol (e.g. GOLD instead of XAUUSD)
                            volume=normalized_volume,
                            price=entry_price_used,
                            direction=direction,
                            order_kind=order_kind,
                        )
                    
                    # Handle invalid stops (10016) - retry once without stops
                    elif result.retcode == 10016:  # TRADE_RETCODE_INVALID_STOPS
                        if order_kind == 'market':
                            # For market orders: retry once without SL/TP
                            logger.warning(
                                f"[RETRY_NO_STOPS] Invalid stops (10016) for {symbol}: retrying without SL/TP"
                            )
                            
                            # Build retry request with same parameters but sl=0, tp=0
                            retry_request = trade_request.copy()
                            retry_request["sl"] = 0.0
                            retry_request["tp"] = 0.0
                            
                            # Send retry order
                            retry_result = mt5.order_send(retry_request)
                            
                            if retry_result is None:
                                error_code, error_desc = mt5.last_error()
                                error_msg = f"OrderSend failed after retry without stops: {error_desc} (code: {error_code})"
                                error_details = {}
                                log_mt5_error("order_send (retry)", error_code, error_desc, {
                                    'symbol': symbol,
                                    'direction': direction,
                                    'order_kind': order_kind,
                                })
                                return self._make_error_response(
                                    error_code=error_code if error_code else -10009,
                                    error_message=error_msg,
                                    symbol=actual_symbol,
                                    direction=direction,
                                    order_kind=order_kind,
                                    volume=normalized_volume,
                                )
                            
                            if retry_result.retcode == mt5.TRADE_RETCODE_DONE:
                                # Success on retry!
                                ticket = retry_result.order
                                logger.info(
                                    f"[RETRY_SUCCESS] {symbol}: Order executed successfully after retry without SL/TP"
                                )
                                log_trade_success("open_trade", ticket, {
                                    'symbol': symbol,
                                    'direction': direction,
                                    'order_kind': order_kind,
                                    'lot_size': lot_size,
                                    'entry_price': entry_price_used,
                                    'stop_loss': 0.0,
                                    'take_profit': 0.0,
                                    'strategy': strategy,
                                    'filling_mode': filling_mode,
                                    'retry_without_stops': True,
                                })
                                # Return structured success response with full context (retry path)
                                return self._make_success_response(
                                    ticket=ticket,
                                    symbol=actual_symbol,  # Use broker symbol
                                    volume=normalized_volume,
                                    price=entry_price_used,
                                    direction=direction,
                                    order_kind=order_kind,
                                )
                            else:
                                # Retry also failed
                                error_msg = f"MT5 order_send failed after retry without stops: {retry_result.comment or 'Unknown error'}"
                                logger.error(
                                    f"[RETRY_FAILED] {symbol}: Retry without stops also failed: "
                                    f"{retry_result.comment} (code: {retry_result.retcode})"
                                )
                                log_mt5_error("order_send (retry)", retry_result.retcode, retry_result.comment or "Unknown error", {
                                    'symbol': symbol,
                                    'direction': direction,
                                    'order_kind': order_kind,
                                    'retcode': retry_result.retcode,
                                })
                                return self._make_error_response(
                                    error_code=retry_result.retcode,
                                    error_message=error_msg,
                                    symbol=actual_symbol,
                                    direction=direction,
                                    order_kind=order_kind,
                                    volume=normalized_volume,
                                )
                        elif attempt == 0:
                            # First attempt failed with invalid stops (pending orders), will retry without stops on next attempt
                            logger.warning(f"[RETRY_NO_STOPS] {symbol}: retrying pending order with sl=0.0, tp=0.0 due to invalid stops error")
                            last_error = f"Invalid stops (code: {result.retcode}): {result.comment}"
                            break  # Break from filling mode loop, will retry on next attempt
                        else:
                            # Already retried without stops, still failed
                            error_msg = f"OrderSend failed: Invalid stops even without SL/TP (code: {result.retcode}) - {result.comment}"
                            error_details = result._asdict() if hasattr(result, '_asdict') else {}
                            log_mt5_error("order_send", result.retcode, result.comment or "Invalid stops", {
                                'symbol': symbol,
                                'direction': direction,
                                'order_kind': order_kind,
                                'retcode': result.retcode,
                            })
                            return {
                                'success': False,
                                'error': error_msg,
                                'details': error_details
                            }
                    elif result.retcode == 10014:  # TRADE_RETCODE_INVALID_VOLUME - invalid volume
                        # Volume error - don't retry with different filling mode, return immediately
                        error_msg = f"OrderSend failed: Invalid volume (code: {result.retcode}) - {result.comment}"
                        error_details = result._asdict() if hasattr(result, '_asdict') else {}
                        log_mt5_error("order_send", result.retcode, result.comment or "Invalid volume", {
                            'symbol': symbol,
                            'direction': direction,
                            'order_kind': order_kind,
                            'original_volume': original_volume,
                            'normalized_volume': normalized_volume,
                            'retcode': result.retcode,
                            'volume_min': symbol_info.volume_min,
                            'volume_max': symbol_info.volume_max,
                            'volume_step': symbol_info.volume_step,
                        })
                        return {
                            'success': False,
                            'error': error_msg,
                            'details': error_details
                        }
                    
                    elif result.retcode == 10030 and action == mt5.TRADE_ACTION_DEAL and filling_mode is not None:  # TRADE_RETCODE_INVALID_FILL - unsupported filling mode
                        # Try next filling mode (only for market orders)
                        last_error = f"Filling mode {filling_mode} not supported (code: {result.retcode}), trying next..."
                        logger.warning(last_error)
                        
                        # If we've exhausted reported modes and haven't tried fallback yet, add fallback modes
                        # Check if we've processed all reported modes (modes_index is 1-based after increment)
                        if modes_index >= len(filling_modes_to_try) and not has_tried_fallback and action == mt5.TRADE_ACTION_DEAL:
                            # All reported modes failed, try all fallback modes that haven't been tried yet
                            tried_filling_modes = [int(mode_str.split('(')[1].rstrip(')')) for mode_str in tried_modes if '(' in mode_str]
                            fallback_to_add = [m for m in all_fallback_modes if m not in tried_filling_modes]
                            if fallback_to_add:
                                mode_names = {1: "RETURN", 2: "IOC", 4: "FOK"}
                                fallback_names = [mode_names.get(m, f"UNKNOWN({m})") for m in fallback_to_add]
                                logger.warning(f"[FALLBACK] All reported filling modes failed, trying fallback modes: {fallback_names}")
                                modes_list.extend(fallback_to_add)
                                has_tried_fallback = True
                        
                        continue  # Continue to next mode (modes_index already incremented)
                    elif result.retcode == 10030 and action == mt5.TRADE_ACTION_PENDING:
                        # Pending orders shouldn't hit this, but handle it
                        error_msg = f"OrderSend failed: {result.comment} (code: {result.retcode})"
                        error_details = result._asdict() if hasattr(result, '_asdict') else {}
                        log_mt5_error("order_send", result.retcode, result.comment or "Unknown error", {
                            'symbol': symbol,
                            'direction': direction,
                            'order_kind': order_kind,
                            'retcode': result.retcode,
                        })
                        return self._make_error_response(
                            error_code=result.retcode,
                            error_message=error_msg,
                            symbol=actual_symbol,
                            direction=direction,
                            order_kind=order_kind,
                            volume=normalized_volume,
                        )
                    
                    elif result.retcode == 10027:  # TRADE_RETCODE_AUTOTRADING_DISABLED
                        # AutoTrading is disabled - don't retry, return helpful error
                        error_msg = (
                            f"AutoTrading disabled by client (code: {result.retcode}). "
                            f"Please enable 'Algo Trading' in MT5 terminal:\n"
                            f"1. Click 'Algo Trading' button in MT5 toolbar (should be green)\n"
                            f"2. Or go to: Tools > Options > Expert Advisors > Check 'Allow automated trading'"
                        )
                        error_details = result._asdict() if hasattr(result, '_asdict') else {}
                        log_mt5_error("order_send", result.retcode, error_msg, {
                            'symbol': symbol,
                            'direction': direction,
                            'order_kind': order_kind,
                            'lot_size': lot_size,
                            'retcode': result.retcode,
                        })
                        return {
                            'success': False,
                            'error': error_msg,
                            'details': error_details
                        }
                    
                    else:
                        # Other error - don't retry with different filling mode for non-filling errors
                        error_msg = f"OrderSend failed: {result.comment} (code: {result.retcode})"
                        error_details = result._asdict() if hasattr(result, '_asdict') else {}
                        log_mt5_error("order_send", result.retcode, result.comment or "Unknown error", {
                            'symbol': symbol,
                            'direction': direction,
                            'order_kind': order_kind,
                            'lot_size': lot_size,
                            'retcode': result.retcode,
                            'filling_mode': filling_mode if action == mt5.TRADE_ACTION_DEAL else None,
                        })
                        # For pending orders, return immediately
                        if action == mt5.TRADE_ACTION_PENDING:
                            return {
                                'success': False,
                                'error': error_msg,
                                'details': error_details
                            }
                        # For market orders, try next filling mode if it's a filling mode error
                        if result.retcode == 10030:
                            last_error = error_msg
                            continue  # Try next filling mode (modes_index already incremented)
                        else:
                            last_error = error_msg
                            break  # Break from filling mode loop for non-filling errors
            
            # All attempts failed
            # Build final error response
            error_details = {}
            if 'result' in locals() and result is not None and hasattr(result, '_asdict'):
                error_details = result._asdict()
            
            if action == mt5.TRADE_ACTION_DEAL:
                # Market order failed
                log_mt5_error("order_send", 0, f"All attempts failed. Tried modes: {', '.join(tried_modes) if tried_modes else 'none'}. Last error: {last_error}", {
                    'symbol': symbol,
                    'direction': direction,
                    'order_kind': order_kind,
                    'lot_size': lot_size,
                    'tried_modes': tried_modes,
                })
                return {
                    'success': False,
                    'error': f"OrderSend failed: No supported filling mode found for {symbol}. Tried modes: {', '.join(tried_modes) if tried_modes else 'none'}. Last error: {last_error or 'Unknown error'}",
                    'details': error_details
                }
            else:
                # Pending order failed
                log_mt5_error("order_send", 0, f"Pending order failed: {last_error or 'Unknown error'}", {
                    'symbol': symbol,
                    'direction': direction,
                    'order_kind': order_kind,
                    'lot_size': lot_size,
                })
                return {
                    'success': False,
                    'error': f"OrderSend failed: {last_error or 'Unknown error'}",
                    'details': error_details
                }
            
        
        except Exception as e:
            error_msg = f"Exception during open_trade: {str(e)}"
            logger.exception(error_msg)
            return self._make_error_response(
                error_code=-10011,  # Local error code for unexpected exception
                error_message=error_msg,
                symbol=request.get('symbol'),
                direction=request.get('direction'),
                order_kind=request.get('order_kind'),
                volume=request.get('lot_size'),
            )
    
    def modify_trade(self, ticket: int, stop_loss: Optional[float] = None, take_profit: Optional[float] = None) -> Dict[str, Any]:
        """
        Modify SL or TP of an open position
        
        Args:
            ticket: MT5 position ticket ID
            stop_loss: New stop loss price (None to keep current)
            take_profit: New take profit price (None to keep current)
        
        Returns:
            Dictionary with 'success' and optionally 'error'
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return {
                'success': False,
                'error': f"MT5 connection failed: {init_msg}"
            }
        
        try:
            # Get position by ticket
            positions = mt5.positions_get(ticket=ticket)
            
            if positions is None or len(positions) == 0:
                error_msg = f"Position with ticket {ticket} not found"
                logger.warning(error_msg)
                return {
                    'success': False,
                    'error': error_msg
                }
            
            position = positions[0]
            
            # Use current SL/TP if not provided
            new_sl = stop_loss if stop_loss is not None else position.sl
            new_tp = take_profit if take_profit is not None else position.tp
            
            # Validate SL/TP using symbol constraints
            symbol_info = mt5.symbol_info(position.symbol)
            if symbol_info is None:
                error_code, error_desc = mt5.last_error()
                return {
                    'success': False,
                    'error': f"Failed to get symbol info for {position.symbol}: {error_code} - {error_desc}"
                }
            
            # Adjust SL/TP if provided
            if stop_loss is not None or take_profit is not None:
                adjusted_sl, adjusted_tp = self._adjust_stop_loss_take_profit(
                    symbol_info, position.price_open, new_sl, new_tp,
                    'buy' if position.type == mt5.ORDER_TYPE_BUY else 'sell'
                )
                new_sl = adjusted_sl
                new_tp = adjusted_tp
            
            # Build modify request
            modify_request = {
                "action": mt5.TRADE_ACTION_SLTP,
                "symbol": position.symbol,
                "position": ticket,
                "sl": new_sl if new_sl else position.sl,  # Use current if None
                "tp": new_tp if new_tp else position.tp,  # Use current if None
            }
            
            # Send modify order
            result = mt5.order_send(modify_request)
            
            if result is None:
                error_code, error_desc = mt5.last_error()
                log_mt5_error("order_send (modify)", error_code, error_desc, {'ticket': ticket})
                return {
                    'success': False,
                    'error': f"Modify order failed: {error_desc} (code: {error_code})"
                }
            
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                log_trade_success("modify_trade", ticket, {
                    'symbol': position.symbol,
                    'new_sl': new_sl,
                    'new_tp': new_tp
                })
                return {
                    'success': True,
                    'ticket': ticket,
                    'new_sl': new_sl,
                    'new_tp': new_tp
                }
            else:
                log_mt5_error("order_send (modify)", result.retcode, result.comment or "Unknown error", {
                    'ticket': ticket
                })
                return {
                    'success': False,
                    'error': f"Modify failed: {result.comment} (code: {result.retcode})"
                }
        
        except Exception as e:
            error_msg = f"Exception during modify_trade: {str(e)}"
            logger.exception(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def partial_close_trade(self, ticket: int, volume_percent: float) -> Dict[str, Any]:
        """
        Close X% of position volume
        
        Args:
            ticket: MT5 position ticket ID
            volume_percent: Percentage of position to close (e.g., 50 = 50%)
        
        Returns:
            Dictionary with 'success' and optionally 'error'
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return {
                'success': False,
                'error': f"MT5 connection failed: {init_msg}"
            }
        
        try:
            # Validate volume_percent
            if volume_percent <= 0 or volume_percent >= 100:
                return {
                    'success': False,
                    'error': f'volume_percent must be between 0 and 100, got {volume_percent}'
                }
            
            # Get position by ticket
            positions = mt5.positions_get(ticket=ticket)
            
            if positions is None or len(positions) == 0:
                error_msg = f"Position with ticket {ticket} not found"
                logger.warning(error_msg)
                return {
                    'success': False,
                    'error': error_msg
                }
            
            position = positions[0]
            
            # Calculate volume to close
            volume_to_close = (position.volume * volume_percent) / 100.0
            
            # Get symbol info for volume normalization
            symbol_info = mt5.symbol_info(position.symbol)
            if symbol_info is None:
                error_code, error_desc = mt5.last_error()
                return {
                    'success': False,
                    'error': f"Failed to get symbol info for {position.symbol}: {error_code} - {error_desc}"
                }
            
            # Normalize volume to broker constraints
            normalized_volume, vol_error = self._normalize_volume(volume_to_close, symbol_info)
            if vol_error:
                return {
                    'success': False,
                    'error': vol_error
                }
            
            # Ensure we don't close more than available
            if normalized_volume >= position.volume:
                # Close full position instead
                return self.close_trade(ticket)
            
            # Determine opposite order type
            if position.type == mt5.ORDER_TYPE_BUY:
                order_type = mt5.ORDER_TYPE_SELL
            else:
                order_type = mt5.ORDER_TYPE_BUY
            
            # Get current market price
            tick = mt5.symbol_info_tick(position.symbol)
            if tick is None:
                error_code, error_desc = mt5.last_error()
                return {
                    'success': False,
                    'error': f"Failed to get market price for {position.symbol}: {error_code}"
                }
            
            # Determine closing price
            if position.type == mt5.ORDER_TYPE_BUY:
                price = tick.bid
            else:
                price = tick.ask
            
            # Get filling modes to try
            filling_modes_to_try = self._get_filling_modes(position.symbol, symbol_info)
            
            # Try closing with different filling modes
            last_error = None
            for filling_mode in filling_modes_to_try:
                # Build partial close request
                close_request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": position.symbol,
                    "volume": normalized_volume,
                    "type": order_type,
                    "position": ticket,
                    "price": price,
                    "deviation": 20,
                    "magic": 123456,
                    "comment": f"ProvidenceX-partial-close-{volume_percent}%",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": filling_mode,
                }
                
                # Send partial close order
                result = mt5.order_send(close_request)
                
                if result is None:
                    error_code, error_desc = mt5.last_error()
                    last_error = f"Partial close order failed: {error_desc} (code: {error_code}, filling_mode: {filling_mode})"
                    if error_code == 10030:  # Unsupported filling mode
                        continue  # Try next filling mode
                    else:
                        log_mt5_error("order_send (partial_close)", error_code, error_desc, {'ticket': ticket})
                        return {
                            'success': False,
                            'error': last_error
                        }
                
                # Check result
                if result.retcode == mt5.TRADE_RETCODE_DONE:
                    # Success!
                    log_trade_success("partial_close_trade", ticket, {
                        'symbol': position.symbol,
                        'volume_closed': normalized_volume,
                        'volume_percent': volume_percent,
                        'remaining_volume': position.volume - normalized_volume,
                        'close_price': price,
                        'filling_mode': filling_mode
                    })
                    
                    return {
                        'success': True,
                        'ticket': ticket,
                        'volume_closed': normalized_volume,
                        'volume_percent': volume_percent,
                        'remaining_volume': position.volume - normalized_volume
                    }
                elif result.retcode == 10030:  # TRADE_RETCODE_INVALID_FILL
                    last_error = f"Filling mode {filling_mode} not supported (code: {result.retcode}), trying next..."
                    continue  # Try next filling mode
                else:
                    # Other error
                    log_mt5_error("order_send (partial_close)", result.retcode, result.comment or "Unknown error", {
                        'ticket': ticket,
                        'retcode': result.retcode,
                        'filling_mode': filling_mode
                    })
                    return {
                        'success': False,
                        'error': f"Partial close failed: {result.comment} (code: {result.retcode})"
                    }
            
            # All filling modes failed
            return {
                'success': False,
                'error': f"Partial close failed: No supported filling mode found. Last error: {last_error}"
            }
        
        except Exception as e:
            error_msg = f"Exception during partial_close_trade: {str(e)}"
            logger.exception(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def close_trade(self, ticket: int) -> Dict[str, Any]:
        """
        Close a position by ticket ID
        
        Args:
            ticket: MT5 position ticket ID
        
        Returns:
            Dictionary with 'success' and optionally 'error'
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return {
                'success': False,
                'error': f"MT5 connection failed: {init_msg}"
            }
        
        try:
            # Get position by ticket
            positions = mt5.positions_get(ticket=ticket)
            
            if positions is None or len(positions) == 0:
                error_msg = f"Position with ticket {ticket} not found"
                logger.warning(error_msg)
                return {
                    'success': False,
                    'error': error_msg
                }
            
            position = positions[0]
            
            # Determine opposite order type
            if position.type == mt5.ORDER_TYPE_BUY:
                order_type = mt5.ORDER_TYPE_SELL
            else:
                order_type = mt5.ORDER_TYPE_BUY
            
            # Get current market price
            tick = mt5.symbol_info_tick(position.symbol)
            if tick is None:
                error_code, error_desc = mt5.last_error()
                log_mt5_error("symbol_info_tick", error_code, error_desc, {
                    'symbol': position.symbol,
                    'ticket': ticket
                })
                return {
                    'success': False,
                    'error': f"Failed to get market price for {position.symbol}: {error_code}"
                }
            
            # Determine closing price
            if position.type == mt5.ORDER_TYPE_BUY:
                price = tick.bid
            else:
                price = tick.ask
            
            # Get filling modes to try
            symbol_info = mt5.symbol_info(position.symbol)
            filling_modes_to_try = self._get_filling_modes(position.symbol, symbol_info)
            
            # Try closing with different filling modes
            last_error = None
            for filling_mode in filling_modes_to_try:
                # Build close request
                close_request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": position.symbol,
                    "volume": position.volume,
                    "type": order_type,
                    "position": ticket,
                    "price": price,
                    "deviation": 20,
                    "magic": 123456,
                    "comment": "ProvidenceX-close",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": filling_mode,
                }
                
                # Send close order
                result = mt5.order_send(close_request)
                
                if result is None:
                    error_code, error_desc = mt5.last_error()
                    last_error = f"Close order failed: {error_desc} (code: {error_code}, filling_mode: {filling_mode})"
                    if error_code == 10030:  # Unsupported filling mode
                        continue  # Try next filling mode
                    else:
                        log_mt5_error("order_send (close)", error_code, error_desc, {'ticket': ticket})
                        return {
                            'success': False,
                            'error': last_error
                        }
                
                # Check result
                if result.retcode == mt5.TRADE_RETCODE_DONE:
                    # Success!
                    log_trade_success("close_trade", ticket, {
                        'symbol': position.symbol,
                        'volume': position.volume,
                        'close_price': price,
                        'filling_mode': filling_mode
                    })
                    
                    return {
                        'success': True
                    }
                elif result.retcode == 10030:  # TRADE_RETCODE_INVALID_FILL
                    last_error = f"Filling mode {filling_mode} not supported (code: {result.retcode}), trying next..."
                    continue  # Try next filling mode
                else:
                    # Other error
                    log_mt5_error("order_send (close)", result.retcode, result.comment or "Unknown error", {
                        'ticket': ticket,
                        'retcode': result.retcode,
                        'filling_mode': filling_mode
                    })
                    return {
                        'success': False,
                        'error': f"Close failed: {result.comment} (code: {result.retcode})"
                    }
            
            # All filling modes failed
            return {
                'success': False,
                'error': f"Close failed: No supported filling mode found. Last error: {last_error}"
            }
        
        except Exception as e:
            error_msg = f"Exception during close_trade: {str(e)}"
            logger.exception(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def _adjust_stop_loss_take_profit(
        self, 
        symbol_info, 
        entry_price: float, 
        requested_sl: Optional[float], 
        requested_tp: Optional[float],
        direction: str
    ) -> Tuple[Optional[float], Optional[float]]:
        """
        Adjust stop loss and take profit to respect minimum stop distance and directional sanity
        
        Args:
            symbol_info: MT5 symbol info object
            entry_price: Entry price for the order (current Bid/Ask for market, pending price for limit/stop)
            requested_sl: Requested stop loss price (can be None)
            requested_tp: Requested take profit price (can be None)
            direction: 'buy' or 'sell'
        
        Returns:
            Tuple of (adjusted_sl, adjusted_tp) - may be None if invalid or on wrong side
        """
        # Get minimum stop distance in points
        point = symbol_info.point
        min_stop_distance_points = symbol_info.trade_stops_level if hasattr(symbol_info, 'trade_stops_level') and symbol_info.trade_stops_level else 0
        min_stop_distance_price = min_stop_distance_points * point
        
        adjusted_sl = None
        adjusted_tp = None
        dir_lower = direction.lower()
        
        # Adjust stop loss with directional sanity check
        if requested_sl is not None and requested_sl > 0:
            if dir_lower == "buy":
                # For BUY: SL must be < entry_price
                if requested_sl >= entry_price:
                    logger.warning(
                        f"Stop loss ignored: requested={requested_sl} is >= entry_price={entry_price} for BUY order"
                    )
                else:
                    # SL must be below entry by at least min_stop_distance
                    max_sl = entry_price - min_stop_distance_price
                    if requested_sl > max_sl:
                        adjusted_sl = max_sl
                        logger.warning(
                            f"Stop loss adjusted: requested={requested_sl}, adjusted={adjusted_sl} "
                            f"(min_stop_distance={min_stop_distance_price})"
                        )
                    else:
                        adjusted_sl = requested_sl
            else:  # sell
                # For SELL: SL must be > entry_price
                if requested_sl <= entry_price:
                    logger.warning(
                        f"Stop loss ignored: requested={requested_sl} is <= entry_price={entry_price} for SELL order"
                    )
                else:
                    # SL must be above entry by at least min_stop_distance
                    min_sl = entry_price + min_stop_distance_price
                    if requested_sl < min_sl:
                        adjusted_sl = min_sl
                        logger.warning(
                            f"Stop loss adjusted: requested={requested_sl}, adjusted={adjusted_sl} "
                            f"(min_stop_distance={min_stop_distance_price})"
                        )
                    else:
                        adjusted_sl = requested_sl
        
        # Adjust take profit with directional sanity check
        if requested_tp is not None and requested_tp > 0:
            if dir_lower == "buy":
                # For BUY: TP must be > entry_price
                if requested_tp <= entry_price:
                    logger.warning(
                        f"Take profit ignored: requested={requested_tp} is <= entry_price={entry_price} for BUY order"
                    )
                else:
                    # TP must be above entry by at least min_stop_distance
                    min_tp = entry_price + min_stop_distance_price
                    if requested_tp < min_tp:
                        adjusted_tp = min_tp
                        logger.warning(
                            f"Take profit adjusted: requested={requested_tp}, adjusted={adjusted_tp} "
                            f"(min_stop_distance={min_stop_distance_price})"
                        )
                    else:
                        adjusted_tp = requested_tp
            else:  # sell
                # For SELL: TP must be < entry_price
                if requested_tp >= entry_price:
                    logger.warning(
                        f"Take profit ignored: requested={requested_tp} is >= entry_price={entry_price} for SELL order"
                    )
                else:
                    # TP must be below entry by at least min_stop_distance
                    max_tp = entry_price - min_stop_distance_price
                    if requested_tp > max_tp:
                        adjusted_tp = max_tp
                        logger.warning(
                            f"Take profit adjusted: requested={requested_tp}, adjusted={adjusted_tp} "
                            f"(min_stop_distance={min_stop_distance_price})"
                        )
                    else:
                        adjusted_tp = requested_tp
        
        return adjusted_sl, adjusted_tp
    
    def _normalize_volume(self, requested: float, symbol_info, symbol: str) -> tuple[float, str | None]:
        """
        Normalize volume according to broker constraints
        
        Args:
            requested: The requested lot size
            symbol_info: MT5 symbol info object with volume_min, volume_max, volume_step
            symbol: Symbol name (for error messages)
        
        Returns:
            Tuple of (normalized_volume, error_message)
            - If validation fails, returns (0.0, error_message)
            - If successful, returns (normalized_volume, None)
        """
        # Get broker constraints with safe defaults
        min_vol = symbol_info.volume_min if hasattr(symbol_info, 'volume_min') and symbol_info.volume_min else 0.01
        max_vol = symbol_info.volume_max if hasattr(symbol_info, 'volume_max') and symbol_info.volume_max else 100.0
        step = symbol_info.volume_step if hasattr(symbol_info, 'volume_step') and symbol_info.volume_step else 0.01
        
        # Reject if requested volume is below minimum BEFORE any manipulation
        if requested < min_vol:
            error_msg = f"Requested volume {requested} below broker minimum {min_vol} for symbol {symbol}"
            logger.warning(error_msg)
            return (0.0, error_msg)
        
        # Clamp to broker max (reject if way too large, or clamp if slightly over)
        if requested > max_vol:
            # For safety, reject if significantly over max (more than 10% over)
            if requested > max_vol * 1.1:
                error_msg = f"Requested volume {requested} exceeds broker maximum {max_vol} for symbol {symbol}"
                logger.warning(error_msg)
                return (0.0, error_msg)
            # Clamp if slightly over (within 10%)
            vol = max_vol
            logger.info(f"Clamping volume from {requested} to broker maximum {max_vol} for {symbol}")
        else:
            vol = requested
        
        # Snap to step
        steps = round(vol / step)
        vol = steps * step
        
        # Reject if rounded volume is still below minimum (shouldn't happen, but safety check)
        if vol < min_vol:
            error_msg = f"Volume {requested} normalized to {vol} which is below broker minimum {min_vol} for symbol {symbol}"
            logger.warning(error_msg)
            return (0.0, error_msg)
        
        return (vol, None)
    
    def _get_filling_modes(self, symbol: str, symbol_info) -> list:
        """
        Determine the appropriate order filling modes for a symbol
        Returns: List of ORDER_FILLING_* constants to try in order
        """
        if symbol_info is None:
            # Fallback: try common modes in order of preference
            logger.warning(f"Symbol {symbol} info is None, trying all filling modes as fallback")
            return [mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK]
        
        filling_modes = symbol_info.filling_mode
        modes_to_try = []
        
        # Log available filling modes
        logger.debug(f"Symbol {symbol} available filling modes (bitmask): {filling_modes}")
        
        # Order of preference: RETURN (most flexible) > IOC > FOK
        # Check available filling modes and add in preferred order
        if filling_modes & mt5.ORDER_FILLING_RETURN:
            modes_to_try.append(mt5.ORDER_FILLING_RETURN)
            logger.debug(f"  - ORDER_FILLING_RETURN (1) is available")
        if filling_modes & mt5.ORDER_FILLING_IOC:
            modes_to_try.append(mt5.ORDER_FILLING_IOC)
            logger.debug(f"  - ORDER_FILLING_IOC (2) is available")
        if filling_modes & mt5.ORDER_FILLING_FOK:
            modes_to_try.append(mt5.ORDER_FILLING_FOK)
            logger.debug(f"  - ORDER_FILLING_FOK (4) is available")
        
        # If no modes found, try all as fallback
        if not modes_to_try:
            modes_to_try = [mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK]
            logger.warning(f"Symbol {symbol} has no recognized filling modes (bitmask={filling_modes}), "
                          f"trying all modes as fallback")
        
        return modes_to_try
    
    def get_open_positions(self) -> Dict[str, Any]:
        """
        Get all open positions from MT5
        
        Returns:
            Dictionary with 'success', 'positions' (list of position dicts), or 'error'
        """
        # Ensure MT5 is connected
        init_success, init_msg = self.ensure_initialized()
        if not init_success:
            return {
                'success': False,
                'error': f"MT5 connection failed: {init_msg}",
                'positions': []
            }
        
        try:
            # Get all open positions
            positions = mt5.positions_get()
            
            if positions is None:
                error_code, error_desc = mt5.last_error()
                if error_code == mt5.RES_S_OK or error_code == 0:
                    # No positions is OK, return empty list
                    return {
                        'success': True,
                        'positions': []
                    }
                log_mt5_error("positions_get", error_code, error_desc)
                return {
                    'success': False,
                    'error': f"Failed to get positions: {error_code} - {error_desc}",
                    'positions': []
                }
            
            # Convert MT5 positions to our format
            from datetime import datetime
            position_list = []
            
            for pos in positions:
                # Map MT5 position type to our direction
                direction = 'buy' if pos.type == mt5.ORDER_TYPE_BUY else 'sell'
                
                # Convert open time from MT5 timestamp to datetime
                open_time_dt = datetime.fromtimestamp(pos.time_open) if pos.time_open else datetime.now()
                
                # Normalize symbol name (remove broker suffixes for consistency if needed)
                # For now, keep as-is but could normalize like in validate_symbol
                symbol = pos.symbol
                
                position_dict = {
                    'symbol': symbol,
                    'ticket': pos.ticket,
                    'direction': direction,
                    'volume': pos.volume,
                    'open_price': pos.price_open,
                    'sl': pos.sl if pos.sl > 0 else None,
                    'tp': pos.tp if pos.tp > 0 else None,
                    'open_time': open_time_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                }
                position_list.append(position_dict)
            
            logger.debug(f"Retrieved {len(position_list)} open positions from MT5")
            
            return {
                'success': True,
                'positions': position_list
            }
            
        except Exception as e:
            error_msg = f"Exception during get_open_positions: {str(e)}"
            logger.exception(error_msg)
            return {
                'success': False,
                'error': error_msg,
                'positions': []
            }

