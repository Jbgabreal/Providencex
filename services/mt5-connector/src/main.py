"""
MT5 Connector v1 - FastAPI Service
Provides REST API for executing trades in MetaTrader 5
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timedelta, timezone
import MetaTrader5 as mt5
from .config import MT5Config
from .mt5_client import MT5Client
from .models import (
    OpenTradeRequest, CloseTradeRequest, TradeResponse, HealthResponse,
    OpenPositionsResponse, OpenPosition, AccountSummaryResponse,
    ModifyTradeRequest, PartialCloseRequest,
    PendingOrdersResponse, PendingOrder, CancelOrderRequest
)
from .order_event_emitter import OrderEventEmitter
from .orderflow_accumulator import get_accumulator
from .utils import logger

# Initialize configuration
config = MT5Config()

# Initialize order flow accumulator (v14)
orderflow_accumulator = get_accumulator()

# Global MT5 client instance
mt5_client: MT5Client = None

# Global order event emitter (v3)
order_event_emitter: OrderEventEmitter = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown"""
    global mt5_client
    
    # Startup
    global mt5_client, order_event_emitter
    
    logger.info("Starting MT5 Connector v1...")
    logger.info(f"Configuration: {config.get_config_dict()}")
    
    mt5_client = MT5Client(config)
    
    # Initialize order event emitter (v3)
    order_event_emitter = OrderEventEmitter(config)
    
    # Try to initialize MT5 (but don't fail if it doesn't connect yet)
    init_success, init_msg = mt5_client.initialize()
    if init_success:
        logger.info("MT5 initialized successfully on startup")
    else:
        logger.warning(f"MT5 initialization deferred: {init_msg}")
        logger.info("MT5 will be initialized on first trade request")
    
    yield
    
    # Shutdown
    logger.info("Shutting down MT5 Connector...")
    if order_event_emitter:
        await order_event_emitter.close()
    if mt5_client:
        mt5_client.shutdown()


# Create FastAPI app
app = FastAPI(
    title="MT5 Connector v1",
    description="ProvidenceX MT5 Connector - Execute trades in MetaTrader 5",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint with detailed MT5 status
    Returns service status, MT5 connection status, and account information
    """
    global mt5_client
    import MetaTrader5 as mt5
    
    if mt5_client is None:
        return HealthResponse(status="ok", mt5_connection=False, account_info=None)
    
    is_connected = mt5_client.is_connected()
    account_info_details = None
    
    # Get detailed account info if connected
    if is_connected:
        try:
            account_info = mt5.account_info()
            if account_info:
                account_info_details = {
                    "login": account_info.login,
                    "server": account_info.server,
                    "balance": float(account_info.balance),
                    "equity": float(account_info.equity),
                    "margin": float(account_info.margin),
                    "free_margin": float(account_info.margin_free),
                    "trade_allowed": bool(account_info.trade_allowed),
                    "trade_expert": bool(account_info.trade_expert),
                    "leverage": account_info.leverage,
                    "margin_mode": account_info.margin_mode,
                    "currency": account_info.currency,
                    "company": account_info.company,
                }
                logger.info(f"Account Info: Login={account_info.login}, Server={account_info.server}, "
                           f"TradeAllowed={account_info.trade_allowed}, TradeExpert={account_info.trade_expert}")
        except Exception as e:
            logger.warning(f"Could not get account info: {e}")
    
    # Also log config status
    logger.info(f"Config Status: {config.get_config_dict()}")
    
    return HealthResponse(
        status="ok",
        mt5_connection=is_connected,
        account_info=account_info_details
    )


@app.get("/api/v1/symbols")
async def list_symbols():
    """
    List available symbols in MT5
    Useful for debugging symbol name issues
    """
    global mt5_client
    
    if mt5_client is None:
        raise HTTPException(status_code=500, detail="MT5 client not initialized")
    
    try:
        # Ensure MT5 is connected
        init_success, init_msg = mt5_client.ensure_initialized()
        if not init_success:
            raise HTTPException(status_code=500, detail=f"MT5 connection failed: {init_msg}")
        
        # Get all symbols
        symbols = mt5.symbols_get()
        if symbols is None:
            account_info = mt5.account_info()
            if account_info is None:
                return {
                    "success": False,
                    "error": "MT5 is not logged in. Please log into your MT5 account first.",
                    "symbols": []
                }
            return {
                "success": False,
                "error": "No symbols available. Make sure symbols are enabled in MT5 Market Watch.",
                "symbols": []
            }
        
        # Return list of symbol names
        symbol_names = [s.name for s in symbols]
        
        # Filter for common trading symbols if there are many
        common_symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'US30', 'SPX500', 'BTCUSD']
        found_common = [s for s in symbol_names if any(cs in s for cs in common_symbols)]
        
        return {
            "success": True,
            "total_symbols": len(symbol_names),
            "common_symbols": found_common[:20],  # First 20 common ones
            "all_symbols": symbol_names[:100] if len(symbol_names) <= 100 else symbol_names[:100] + [f"... and {len(symbol_names) - 100} more"],
            "note": "Enable symbols in MT5 Market Watch if they're not showing up"
        }
    
    except Exception as e:
        logger.exception(f"Error listing symbols: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing symbols: {str(e)}")


@app.get("/api/v1/price/{symbol}")
async def get_price(symbol: str):
    """
    Get current price tick for a symbol
    
    Returns live bid/ask/last prices from MT5 for the specified symbol.
    Automatically resolves broker-specific symbol names (e.g., XAUUSD -> GOLD).
    Also accumulates tick for order flow calculations (v14).
    """
    global mt5_client, orderflow_accumulator
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    logger.debug(f"Received price request for symbol: {symbol}")
    
    # Get price from MT5 client
    result = mt5_client.get_price(symbol)
    
    if not result.get('success'):
        error_msg = result.get('error', 'Unknown error')
        raise HTTPException(status_code=400, detail=error_msg)
    
    # Accumulate tick for order flow (v14)
    try:
        if 'bid' in result and 'ask' in result:
            from datetime import datetime
            bid = float(result['bid'])
            ask = float(result['ask'])
            volume = result.get('volume', 1)  # Tick volume (default to 1 if not available)
            tick_time = datetime.now()
            
            orderflow_accumulator.add_tick(symbol, bid, ask, volume, tick_time)
    except Exception as e:
        # Don't fail price request if order flow accumulation fails
        logger.warning(f"Failed to accumulate tick for order flow: {e}")
    
    return result


@app.post("/api/v1/trades/open", response_model=TradeResponse)
async def open_trade(request: OpenTradeRequest):
    """
    Open a new market order
    
    Validates the request, ensures MT5 is connected, and executes the trade.
    Returns ticket ID on success or error message on failure.
    """
    global mt5_client
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    logger.info(
        f"Received open trade request: {request.symbol} {request.direction} {request.lot_size} lots, "
        f"SL={request.stop_loss}, TP={request.take_profit}, entry={request.entry_price}"
    )
    
    # Validate stop loss is provided (safety check - ExecutionService should have already validated)
    # Note: stop_loss_price is automatically mapped to stop_loss by Pydantic validator
    if request.stop_loss is None or request.stop_loss <= 0:
        error_msg = f"Stop Loss is required but was not provided or invalid (SL={request.stop_loss}). Trade rejected for safety."
        logger.error(error_msg)
        raise HTTPException(
            status_code=400,
            detail=error_msg
        )
    
    # Log if stop loss will need adjustment (for market orders, execution price may differ from signal.entry)
    if request.order_kind == 'market':
        logger.debug(
            f"Market order: Stop loss will be validated/adjusted against actual execution price, "
            f"not signal entry ({request.entry_price})"
        )
    
    # Convert request to dictionary for mt5_client
    # Note: Pydantic validators have already normalized the field names
    request_dict = {
        'symbol': request.symbol,
        'direction': request.direction.lower(),  # Ensure lowercase
        'order_kind': request.order_kind,  # 'market', 'limit', or 'stop'
        'entry_price': request.entry_price,  # Required for pending orders, ignored for market
        'lot_size': request.lot_size,
        'stop_loss': request.stop_loss,
        'take_profit': request.take_profit,
        'strategy': request.strategy,
    }
    
    logger.info(f"Trade request dict: SL={request_dict['stop_loss']}, TP={request_dict['take_profit']}")
    
    # Execute trade
    result = mt5_client.open_trade(request_dict)
    
    if result['success']:
        ticket = result.get('ticket')
        
        # Emit order_sent event (v3) - fire and forget
        if order_event_emitter and order_event_emitter.enabled:
            asyncio.create_task(order_event_emitter.emit_order_sent(
                ticket=ticket,
                symbol=request.symbol,
                direction=request.direction.lower(),
                volume=request.lot_size,
                entry_price=result.get('price') or request.entry_price,
                order_kind=request.order_kind,
            ))
            # Also emit position_opened if it's a market order that executed immediately
            if request.order_kind == 'market':
                asyncio.create_task(order_event_emitter.emit_position_opened({
                    'ticket': ticket,
                    'symbol': request.symbol,
                    'direction': request.direction.lower(),
                    'volume': request.lot_size,
                    'open_price': result.get('price'),
                    'entry_price': result.get('price'),
                    'sl_price': request.stop_loss,
                    'tp_price': request.take_profit,
                    'magic': 123456,
                    'comment': 'ProvidenceX',
                }))
        
        return TradeResponse(
            success=True,
            ticket=ticket
        )
    else:
        # Return 400 Bad Request for client errors, 500 for server errors
        # Check both 'error' and 'error_message' keys for compatibility
        error_msg = result.get('error') or result.get('error_message', 'Unknown error')
        
        # Check if it's a validation error (client error) vs connection error (server error)
        if 'connection' in error_msg.lower() or 'initialize' in error_msg.lower():
            status_code = 500
        else:
            status_code = 400
        
        raise HTTPException(
            status_code=status_code,
            detail=error_msg
        )


@app.post("/api/v1/trades/close", response_model=TradeResponse)
async def close_trade(request: CloseTradeRequest):
    """
    Close an existing position by ticket ID
    
    Finds the position and executes a closing order.
    """
    global mt5_client, order_event_emitter
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    ticket = request.ticket
    if request.mt5_ticket and ticket != request.mt5_ticket:
        ticket = request.mt5_ticket
    
    logger.info(f"Received close trade request: ticket {ticket}, reason: {request.reason or 'N/A'}")
    
    # Execute close
    result = mt5_client.close_trade(ticket)
    
    if result['success']:
        # Note: position_closed events will be emitted via MT5 history polling (v3)
        # For immediate emission, we would need to get position details here
        # For now, Trading Engine will poll MT5 history to detect closed positions
        
        return TradeResponse(success=True)
    else:
        error_msg = result.get('error', 'Unknown error')
        
        # Position not found is a client error, connection issues are server errors
        if 'not found' in error_msg.lower():
            status_code = 404
        elif 'connection' in error_msg.lower():
            status_code = 500
        else:
            status_code = 400
        
        raise HTTPException(
            status_code=status_code,
            detail=error_msg
        )


@app.post("/api/v1/trades/modify", response_model=TradeResponse)
async def modify_trade(request: ModifyTradeRequest):
    """
    Modify SL or TP of an open position
    
    Validates the request, ensures MT5 is connected, and modifies the trade.
    Returns success status or error message.
    """
    global mt5_client, order_event_emitter
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    logger.info(f"Received modify trade request: ticket {request.ticket}, sl={request.stop_loss}, tp={request.take_profit}")
    
    # Execute modify
    result = mt5_client.modify_trade(
        ticket=request.ticket,
        stop_loss=request.stop_loss,
        take_profit=request.take_profit
    )
    
    if result['success']:
        # Emit position_modified event (v9) - fire and forget
        if order_event_emitter and order_event_emitter.enabled:
            # Get position details for event
            positions = mt5.positions_get(ticket=request.ticket)
            if positions and len(positions) > 0:
                pos = positions[0]
                event_type = 'sl_modified' if request.stop_loss is not None else 'tp_modified'
                if request.stop_loss is not None and request.take_profit is not None:
                    event_type = 'position_modified'
                
                # Determine event type based on what was modified
                if request.stop_loss is not None and request.take_profit is None:
                    event_type = 'sl_modified'
                elif request.take_profit is not None and request.stop_loss is None:
                    event_type = 'tp_modified'
                else:
                    event_type = 'position_modified'
                
                asyncio.create_task(order_event_emitter.emit_position_modified({
                    'ticket': request.ticket,
                    'symbol': pos.symbol,
                    'direction': 'buy' if pos.type == mt5.ORDER_TYPE_BUY else 'sell',
                    'sl_price': result.get('new_sl') or pos.sl,
                    'tp_price': result.get('new_tp') or pos.tp,
                    'event_type': event_type,
                }))
        
        return TradeResponse(success=True, ticket=request.ticket)
    else:
        error_msg = result.get('error', 'Unknown error')
        logger.error(f"Failed to modify trade: {error_msg}")
        raise HTTPException(
            status_code=400,
            detail=error_msg
        )


@app.post("/api/v1/trades/partial-close", response_model=TradeResponse)
async def partial_close_trade(request: PartialCloseRequest):
    """
    Close X% of position volume
    
    Validates the request, ensures MT5 is connected, and executes partial close.
    Returns success status or error message.
    """
    global mt5_client, order_event_emitter
    import MetaTrader5 as mt5
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    logger.info(f"Received partial close request: ticket {request.ticket}, volume_percent={request.volume_percent}%")
    
    # Execute partial close
    result = mt5_client.partial_close_trade(
        ticket=request.ticket,
        volume_percent=request.volume_percent
    )
    
    if result['success']:
        # Emit partial_close event (v9) - fire and forget
        if order_event_emitter and order_event_emitter.enabled:
            # Get position details for event
            positions = mt5.positions_get(ticket=request.ticket)
            if positions and len(positions) > 0:
                pos = positions[0]
                asyncio.create_task(order_event_emitter.emit_partial_close({
                    'ticket': request.ticket,
                    'symbol': pos.symbol,
                    'direction': 'buy' if pos.type == mt5.ORDER_TYPE_BUY else 'sell',
                    'volume_closed': result.get('volume_closed'),
                    'volume_percent': request.volume_percent,
                    'remaining_volume': result.get('remaining_volume'),
                }))
        
        return TradeResponse(success=True, ticket=request.ticket)
    else:
        error_msg = result.get('error', 'Unknown error')
        logger.error(f"Failed to partial close trade: {error_msg}")
        raise HTTPException(
            status_code=400,
            detail=error_msg
        )


@app.get("/api/v1/account-summary", response_model=AccountSummaryResponse)
async def get_account_summary():
    """
    Get account summary from MT5 (v7)
    
    Returns balance, equity, margin, free margin, margin level, and currency.
    Used for live PnL tracking and kill switch evaluation.
    """
    global mt5_client
    import MetaTrader5 as mt5
    
    if mt5_client is None or not mt5_client.is_connected():
        return AccountSummaryResponse(
            success=False,
            error="MT5 not connected"
        )
    
    try:
        account_info = mt5.account_info()
        if not account_info:
            return AccountSummaryResponse(
                success=False,
                error="Failed to get account info from MT5"
            )
        
        return AccountSummaryResponse(
            success=True,
            balance=float(account_info.balance),
            equity=float(account_info.equity),
            margin=float(account_info.margin),
            free_margin=float(account_info.margin_free),
            margin_level=float(account_info.margin_level) if account_info.margin_level > 0 else None,
            currency=account_info.currency,
        )
    except Exception as e:
        logger.error(f"Error getting account summary: {e}")
        return AccountSummaryResponse(
            success=False,
            error=str(e)
        )


@app.get("/api/v1/order-flow/{symbol}")
async def get_order_flow(symbol: str):
    """
    Get order flow metrics for a symbol (v14)
    
    Returns aggregated order flow data for the last N seconds:
    - bid_volume, ask_volume
    - delta (ask_volume - bid_volume)
    - imbalance percentages
    - large order detection
    
    Automatically resolves broker-specific symbol names.
    """
    global mt5_client, orderflow_accumulator
    
    try:
        if mt5_client is None:
            raise HTTPException(
                status_code=500,
                detail="MT5 client not initialized"
            )
        
        logger.debug(f"Received order flow request for symbol: {symbol}")
        
        # Ensure MT5 is connected (will reinitialize if needed)
        try:
            init_success, init_msg = mt5_client.ensure_initialized()
            if not init_success:
                logger.warning(f"MT5 connection failed for order flow: {init_msg}")
                raise HTTPException(
                    status_code=502,
                    detail=f"MT5 connection failed: {init_msg}"
                )
        except Exception as conn_error:
            logger.error(f"MT5 connection error in order flow endpoint: {conn_error}")
            raise HTTPException(
                status_code=502,
                detail=f"MT5 connection error: {str(conn_error)}"
            )
        
        # Resolve symbol name (use same validation logic as get_price)
        try:
            symbol_valid, resolved_symbol, symbol_msg = mt5_client.validate_symbol(symbol)
            if not symbol_valid:
                raise HTTPException(
                    status_code=404,
                    detail=symbol_msg or f"Symbol {symbol} not found in MT5"
                )
        except HTTPException:
            raise  # Re-raise HTTP exceptions
        except Exception as sym_error:
            logger.error(f"Symbol validation error: {sym_error}")
            raise HTTPException(
                status_code=400,
                detail=f"Symbol validation failed: {str(sym_error)}"
            )
        
        # Ensure accumulator is available
        if orderflow_accumulator is None:
            logger.warning("Order flow accumulator not initialized, returning neutral values")
            return {
                "symbol": resolved_symbol,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "bid_volume": 0.0,
                "ask_volume": 0.0,
                "delta": 0.0,
                "delta_sign": "neutral",
                "imbalance_buy_pct": 50.0,
                "imbalance_sell_pct": 50.0,
                "large_orders": [],
            }
        
        # Try to fetch a fresh tick to populate accumulator (if not already done)
        # This ensures we have recent data even if price endpoint hasn't been called recently
        try:
            tick = mt5.symbol_info_tick(resolved_symbol)
            if tick is not None:
                bid = float(tick.bid)
                ask = float(tick.ask)
                volume = tick.volume if hasattr(tick, 'volume') and tick.volume else 1
                tick_time = datetime.fromtimestamp(tick.time) if tick.time else datetime.utcnow()
                orderflow_accumulator.add_tick(resolved_symbol, bid, ask, volume, tick_time)
        except Exception as tick_error:
            logger.debug(f"Could not fetch fresh tick for {resolved_symbol}: {tick_error}")
            # Continue anyway - accumulator may already have data
        
        # Compute order flow from accumulator
        try:
            order_flow = orderflow_accumulator.compute_order_flow(resolved_symbol)
            
            if order_flow is None:
                # Return default/neutral values if insufficient data
                logger.debug(f"Insufficient order flow data for {resolved_symbol}, returning neutral values")
                return {
                    "symbol": resolved_symbol,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "bid_volume": 0.0,
                    "ask_volume": 0.0,
                    "delta": 0.0,
                    "delta_sign": "neutral",
                    "imbalance_buy_pct": 50.0,
                    "imbalance_sell_pct": 50.0,
                    "large_orders": [],
                }
            
            return order_flow
            
        except Exception as flow_error:
            logger.error(f"Order flow computation error for {resolved_symbol}: {flow_error}")
            # Return neutral values instead of crashing
            return {
                "symbol": resolved_symbol,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "bid_volume": 0.0,
                "ask_volume": 0.0,
                "delta": 0.0,
                "delta_sign": "neutral",
                "imbalance_buy_pct": 50.0,
                "imbalance_sell_pct": 50.0,
                "large_orders": [],
            }
    
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.exception(f"Unexpected error in order flow endpoint for {symbol}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


@app.get("/api/v1/open-positions", response_model=OpenPositionsResponse)
async def get_open_positions():
    """
    Get all open positions from MT5
    
    Returns a list of all currently open positions with their details.
    Useful for exposure monitoring and risk management.
    """
    global mt5_client
    
    try:
        if mt5_client is None:
            raise HTTPException(
                status_code=500,
                detail="MT5 client not initialized"
            )
        
        logger.debug("Received open positions request")
        
        # Ensure MT5 is connected (will reinitialize if needed)
        try:
            init_success, init_msg = mt5_client.ensure_initialized()
            if not init_success:
                logger.warning(f"MT5 connection failed for open positions: {init_msg}")
                raise HTTPException(
                    status_code=502,
                    detail=f"MT5 connection failed: {init_msg}"
                )
        except HTTPException:
            raise  # Re-raise HTTP exceptions
        except Exception as conn_error:
            logger.error(f"MT5 connection error in open positions endpoint: {conn_error}")
            raise HTTPException(
                status_code=502,
                detail=f"MT5 connection error: {str(conn_error)}"
            )
        
        # Get positions from MT5 client
        try:
            result = mt5_client.get_open_positions()
            
            if result['success']:
                # Convert position dicts to Pydantic models
                positions = [
                    OpenPosition(
                        symbol=pos['symbol'],
                        ticket=pos['ticket'],
                        direction=pos['direction'],
                        volume=pos['volume'],
                        open_price=pos['open_price'],
                        sl=pos.get('sl'),
                        tp=pos.get('tp'),
                        open_time=pos['open_time']
                    )
                    for pos in result['positions']
                ]
                
                logger.debug(f"Retrieved {len(positions)} open positions from MT5")
                
                return OpenPositionsResponse(
                    success=True,
                    positions=positions
                )
            else:
                error_msg = result.get('error', 'Unknown error')
                logger.error(f"Failed to get open positions: {error_msg}")
                
                # Return empty positions list instead of raising exception for connection errors
                # This allows the trading engine to continue operating
                if 'connection' in error_msg.lower() or 'initialize' in error_msg.lower():
                    logger.warning("MT5 connection error, returning empty positions list")
                    return OpenPositionsResponse(
                        success=False,
                        error=error_msg,
                        positions=[]
                    )
                else:
                    # For other errors, still return empty list but log the error
                    logger.warning(f"MT5 error getting positions, returning empty list: {error_msg}")
                    return OpenPositionsResponse(
                        success=False,
                        error=error_msg,
                        positions=[]
                    )
        
        except Exception as pos_error:
            logger.exception(f"Exception getting open positions from MT5: {pos_error}")
            # Return empty positions instead of crashing
            return OpenPositionsResponse(
                success=False,
                error=f"Error getting positions: {str(pos_error)}",
                positions=[]
            )
    
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.exception(f"Unexpected error in open positions endpoint: {e}")
        # Return empty positions list instead of crashing
        return OpenPositionsResponse(
            success=False,
            error=f"Internal server error: {str(e)}",
            positions=[]
        )


@app.get("/api/v1/pending-orders", response_model=PendingOrdersResponse)
async def get_pending_orders():
    """
    Get all pending orders from MT5 (limit/stop orders)
    
    Returns a list of all currently pending orders with their details.
    """
    global mt5_client
    
    if mt5_client is None:
        return PendingOrdersResponse(
            success=False,
            orders=[],
            error="MT5 client not initialized"
        )
    
    try:
        logger.debug("Received pending orders request")
        
        # Ensure MT5 is connected
        try:
            init_success, init_msg = mt5_client.ensure_initialized()
            if not init_success:
                logger.warning(f"MT5 connection failed for pending orders: {init_msg}")
                return PendingOrdersResponse(
                    success=False,
                    orders=[],
                    error=f"MT5 connection failed: {init_msg}"
                )
        except Exception as conn_error:
            logger.error(f"MT5 connection error in pending orders endpoint: {conn_error}")
            return PendingOrdersResponse(
                success=False,
                orders=[],
                error=f"MT5 connection error: {str(conn_error)}"
            )
        
        try:
            result = mt5_client.get_pending_orders()
            
            if result['success']:
                orders = result.get('orders', [])
                logger.debug(f"Retrieved {len(orders)} pending orders from MT5")
                
                # Convert to PendingOrder models
                pending_orders = [
                    PendingOrder(
                        symbol=order['symbol'],
                        ticket=order['ticket'],
                        direction=order['direction'],
                        order_kind=order['order_kind'],
                        volume=order['volume'],
                        entry_price=order['entry_price'],
                        sl=order.get('sl'),
                        tp=order.get('tp'),
                        setup_time=order['setup_time']
                    )
                    for order in orders
                ]
                
                return PendingOrdersResponse(
                    success=True,
                    orders=pending_orders
                )
            else:
                error_msg = result.get('error', 'Unknown error')
                logger.error(f"Failed to get pending orders: {error_msg}")
                return PendingOrdersResponse(
                    success=False,
                    orders=[],
                    error=error_msg
                )
        except Exception as pos_error:
            logger.exception(f"Exception getting pending orders from MT5: {pos_error}")
            return PendingOrdersResponse(
                success=False,
                orders=[],
                error=f"Exception: {str(pos_error)}"
            )
    except Exception as e:
        logger.exception(f"Unexpected error in pending orders endpoint: {e}")
        return PendingOrdersResponse(
            success=False,
            orders=[],
            error=str(e)
        )


@app.post("/api/v1/trades/cancel", response_model=TradeResponse)
async def cancel_order(request: CancelOrderRequest):
    """
    Cancel a pending order by ticket ID
    
    Finds the pending order and cancels it.
    """
    global mt5_client
    
    if mt5_client is None:
        raise HTTPException(
            status_code=500,
            detail="MT5 client not initialized"
        )
    
    ticket = request.ticket
    if request.mt5_ticket and ticket != request.mt5_ticket:
        ticket = request.mt5_ticket
    
    logger.info(f"Received cancel order request: ticket {ticket}")
    
    # Execute cancel
    result = mt5_client.cancel_order(ticket)
    
    if result['success']:
        return TradeResponse(success=True, ticket=ticket)
    else:
        error_msg = result.get('error', 'Unknown error')
        
        # Order not found is a client error, connection issues are server errors
        if 'not found' in error_msg.lower():
            status_code = 404
        elif 'connection' in error_msg.lower():
            status_code = 500
        else:
            status_code = 400
        
        raise HTTPException(
            status_code=status_code,
            detail=error_msg
        )


@app.get("/api/v1/history")
async def get_history(
    symbol: str = Query(..., description="Trading symbol (e.g., XAUUSD, EURUSD)"),
    timeframe: str = Query("M1", description="Timeframe (M1, M5, M15, H1, etc.)"),
    days: int = Query(None, description="Number of days of history (default from config)"),
    startDate: str = Query(None, description="Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS). If provided, overrides 'days' parameter"),
    endDate: str = Query(None, description="End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS). If not provided, uses current broker time")
):
    """
    Get historical candle data for a symbol
    
    Returns historical OHLCV candles from MT5 for the specified symbol and date range.
    Automatically resolves broker-specific symbol names (e.g., XAUUSD -> GOLD).
    
    Args:
        symbol: Trading symbol (required)
        timeframe: Timeframe identifier (default: M1)
        days: Number of days of history (default: from HISTORICAL_BACKFILL_DEFAULT_DAYS env).
              Ignored if startDate is provided.
        startDate: Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
                   If provided, fetches historical data for the exact date range.
        endDate: End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
                 If not provided when startDate is set, uses current broker time.
    
    Returns:
        JSON array of candles: [{"time": "ISO8601", "open": float, "high": float, "low": float, "close": float, "volume": int}, ...]
    """
    global mt5_client
    
    try:
        if mt5_client is None:
            raise HTTPException(
                status_code=500,
                detail="MT5 client not initialized"
            )
        
        if not symbol or not symbol.strip():
            raise HTTPException(
                status_code=400,
                detail="Symbol parameter is required and cannot be empty"
            )
        
        # Use default days from config if not provided
        if days is None:
            days = config.historical_backfill_default_days
        
        logger.info(f"Received history request: symbol={symbol}, timeframe={timeframe}, days={days}")
        
        # Ensure MT5 is connected
        try:
            init_success, init_msg = mt5_client.ensure_initialized()
            if not init_success:
                logger.warning(f"MT5 connection failed for history: {init_msg}")
                raise HTTPException(
                    status_code=502,
                    detail=f"MT5 connection failed: {init_msg}"
                )
        except HTTPException:
            raise  # Re-raise HTTP exceptions
        except Exception as conn_error:
            logger.error(f"MT5 connection error in history endpoint: {conn_error}")
            raise HTTPException(
                status_code=502,
                detail=f"MT5 connection error: {str(conn_error)}"
            )
        
        # Validate and resolve symbol
        symbol_valid, resolved_symbol, symbol_msg = mt5_client.validate_symbol(symbol)
        if not symbol_valid:
            raise HTTPException(
                status_code=404,
                detail=symbol_msg or f"Symbol {symbol} not found in MT5"
            )
        
        # Map timeframe string to MT5 constant
        timeframe_map = {
            'M1': mt5.TIMEFRAME_M1,
            'M5': mt5.TIMEFRAME_M5,
            'M15': mt5.TIMEFRAME_M15,
            'H1': mt5.TIMEFRAME_H1,
            'H4': mt5.TIMEFRAME_H4,
        }
        
        mt5_timeframe = timeframe_map.get(timeframe.upper())
        if mt5_timeframe is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported timeframe: {timeframe}. Supported: {', '.join(timeframe_map.keys())}"
            )
        
        # Calculate date range
        # MT5 copy_rates_range expects naive datetime objects (no timezone, no microseconds)
        # Use UTC time for consistency and remove microseconds
        use_historical_dates = startDate is not None
        
        if use_historical_dates:
            # Parse startDate and endDate for historical data requests
            try:
                # Parse ISO format dates (support both YYYY-MM-DD and YYYY-MM-DDTHH:MM:SS)
                def parse_date(date_str: str) -> datetime:
                    """Parse date string to naive UTC datetime"""
                    if 'T' in date_str:
                        # Has time component - parse as ISO format
                        # Replace Z with +00:00 for proper timezone parsing
                        date_str_normalized = date_str.replace('Z', '+00:00')
                        dt = datetime.fromisoformat(date_str_normalized)
                        # Convert to UTC if timezone-aware, then make naive
                        if dt.tzinfo:
                            # Convert to UTC, then remove timezone info
                            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
                        return dt.replace(microsecond=0)
                    else:
                        # Date only - parse and set to start of day UTC
                        return datetime.strptime(date_str, '%Y-%m-%d').replace(microsecond=0)
                
                start_time = parse_date(startDate)
                
                if endDate:
                    end_time = parse_date(endDate)
                    # If endDate is date-only, add 23:59:59 to include the full day
                    if 'T' not in endDate:
                        end_time = end_time.replace(hour=23, minute=59, second=59)
                else:
                    # If endDate not provided, use current broker time
                    try:
                        broker_tick = mt5.symbol_info_tick(resolved_symbol)
                        if broker_tick and broker_tick.time:
                            end_time = datetime.utcfromtimestamp(broker_tick.time).replace(microsecond=0)
                        else:
                            end_time = datetime.utcnow().replace(microsecond=0)
                    except Exception:
                        end_time = datetime.utcnow().replace(microsecond=0)
                
                logger.info(f"Using historical date range: {start_time} to {end_time} (UTC, naive)")
            except ValueError as date_error:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format. Use ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS): {str(date_error)}"
                )
        else:
            # Legacy behavior: use days parameter (last N days from current broker time)
            try:
                broker_tick = mt5.symbol_info_tick(resolved_symbol)
                if broker_tick and broker_tick.time:
                    # MT5 tick.time is Unix timestamp in seconds
                    # Create naive UTC datetime (MT5 expects naive datetime, no timezone)
                    end_time = datetime.utcfromtimestamp(broker_tick.time).replace(microsecond=0)
                    logger.debug(f"Using broker time for {resolved_symbol}: {end_time} (UTC, naive)")
                else:
                    end_time = datetime.utcnow().replace(microsecond=0)
                    logger.debug(f"Broker time not available, using UTC now: {end_time}")
            except Exception as tick_error:
                end_time = datetime.utcnow().replace(microsecond=0)
                logger.warning(f"Could not get broker time, using UTC now: {tick_error}")
            
            start_time = (end_time - timedelta(days=days)).replace(microsecond=0)
        
        if use_historical_dates:
            # For historical date ranges, use copy_rates_range directly
            logger.info(f"Fetching historical data for {resolved_symbol}: {timeframe}, date range: {start_time} to {end_time}")
            rates = mt5.copy_rates_range(resolved_symbol, mt5_timeframe, start_time, end_time)
        else:
            # Legacy behavior: use copy_rates_from_pos first (more reliable - doesn't depend on date calculations)
            # Calculate approximate number of candles needed
            candles_per_day_map = {
                'M1': 24 * 60,      # 1440 candles per day
                'M5': 24 * 12,      # 288 candles per day  
                'M15': 24 * 4,      # 96 candles per day
                'H1': 24,           # 24 candles per day
                'H4': 6,            # 6 candles per day
            }
            candles_per_day = candles_per_day_map.get(timeframe.upper(), 1440)
            requested_count = days * candles_per_day
            
            # MT5 typically allows up to 100k candles, but be conservative
            # For 90 days of M1: 90 * 1440 = 129,600 candles (exceeds limit)
            # Limit to 50k candles (~35 days of M1) to be safe
            count = min(50000, max(100, requested_count))
            
            logger.info(f"Fetching history for {resolved_symbol}: {timeframe}, requesting last {count} candles (≈{count/candles_per_day:.1f} days)")
            
            # Fetch using copy_rates_from_pos (position 0 = current bar, count = number of bars to retrieve backwards)
            rates = mt5.copy_rates_from_pos(resolved_symbol, mt5_timeframe, 0, count)
            
            # If copy_rates_from_pos fails or returns None, try copy_rates_range as fallback
            if rates is None or len(rates) == 0:
                logger.warning(f"copy_rates_from_pos returned no data, trying fallback: copy_rates_range...")
                logger.info(f"Fallback date range: {start_time} to {end_time}")
                rates = mt5.copy_rates_range(resolved_symbol, mt5_timeframe, start_time, end_time)
        
        if rates is None:
            error_code, error_desc = mt5.last_error()
            logger.error(f"MT5 history fetch failed for {resolved_symbol}: {error_code} - {error_desc}")
            logger.error(f"  Timeframe: {timeframe} (MT5: {mt5_timeframe})")
            logger.error(f"  Symbol resolved to: {resolved_symbol}")
            logger.error(f"  Tried copy_rates_from_pos({count} candles) and fallback copy_rates_range")
            logger.error(f"  Check if symbol is in Market Watch and MT5 has history enabled/synchronized")
            return []
        
        if len(rates) == 0:
            logger.warning(f"No history returned for {resolved_symbol} (timeframe={timeframe}, days={days})")
            logger.warning(f"  Tried requesting {count} candles using copy_rates_from_pos")
            logger.warning(f"  Check if symbol is in Market Watch and MT5 has history enabled/synchronized")
            return []
        
        # Convert MT5 rates to JSON format
        # Note: MT5 copy_rates_from_pos returns candles in reverse chronological order (newest first)
        candles = []
        for rate in rates:
            # MT5 rate is a numpy array with fields: time, open, high, low, close, tick_volume, spread, real_volume
            # Convert time (seconds since 1970) to ISO string
            rate_time = datetime.fromtimestamp(rate['time'])
            candles.append({
                "time": rate_time.strftime('%Y-%m-%dT%H:%M:%SZ'),
                "open": float(rate['open']),
                "high": float(rate['high']),
                "low": float(rate['low']),
                "close": float(rate['close']),
                "volume": int(rate['tick_volume'])  # Use tick_volume for consistency
            })
        
        # Sort by time (ascending - oldest first) to ensure chronological order
        candles.sort(key=lambda x: x['time'])
        
        # Filter candles to the requested date range
        if len(candles) > 0 and not use_historical_dates:
            # Legacy behavior: filter to keep only the most recent N days worth of candles
            # Calculate cutoff time (N days ago from the newest candle)
            newest_time = datetime.fromisoformat(candles[-1]['time'].replace('Z', '+00:00'))
            cutoff_time = newest_time - timedelta(days=days)
            
            # Filter candles to only include those within the requested date range
            filtered_candles = [
                c for c in candles 
                if datetime.fromisoformat(c['time'].replace('Z', '+00:00')) >= cutoff_time
            ]
            
            if len(filtered_candles) < len(candles):
                logger.debug(
                    f"Filtered {len(candles)} candles to {len(filtered_candles)} candles "
                    f"within {days} days for {resolved_symbol}"
                )
            
            candles = filtered_candles
        elif use_historical_dates and len(candles) > 0:
            # For historical dates, filter to exact date range
            filtered_candles = []
            for c in candles:
                candle_time = datetime.fromisoformat(c['time'].replace('Z', '+00:00')).replace(tzinfo=None)
                if start_time <= candle_time <= end_time:
                    filtered_candles.append(c)
            
            if len(filtered_candles) < len(candles):
                logger.debug(
                    f"Filtered {len(candles)} candles to {len(filtered_candles)} candles "
                    f"within historical range {start_time} to {end_time} for {resolved_symbol}"
                )
            
            candles = filtered_candles
        
        if len(candles) > 0:
            logger.info(
                f"Returning {len(candles)} candles for {resolved_symbol} "
                f"(timeframe={timeframe}, range: {candles[0]['time']} to {candles[-1]['time']})"
            )
        else:
            logger.warning(f"No candles returned for {resolved_symbol} after filtering")
        
        return candles
    
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.exception(f"Unexpected error in history endpoint for {symbol}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


# For development: run with uvicorn
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=config.fastapi_port,
        reload=True  # Auto-reload on code changes
    )

