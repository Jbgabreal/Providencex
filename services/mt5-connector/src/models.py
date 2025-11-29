"""
Pydantic models for trade requests and responses
"""
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal, List
from datetime import datetime


class OpenTradeRequest(BaseModel):
    """Request model for opening a trade
    
    Supports both PRD format and Trading Engine format for backward compatibility.
    """
    symbol: str = Field(..., description="Trading symbol (e.g., 'XAUUSD', 'EURUSD')")
    direction: str = Field(..., description="Trade direction: 'buy'/'sell' or 'BUY'/'SELL'")
    order_kind: Literal['market', 'limit', 'stop'] = Field(..., description="Order type: 'market', 'limit', or 'stop'")
    lot_size: float = Field(..., gt=0, description="Lot size (e.g., 0.10)")
    entry_price: Optional[float] = Field(None, description="Entry price (required for limit/stop orders, ignored for market)")
    stop_loss: Optional[float] = Field(None, description="Stop loss price")
    take_profit: Optional[float] = Field(None, description="Take profit price")
    strategy: str = Field(default="low", description="Strategy identifier")
    strategy_id: str = Field(None, description="Alternative strategy field (for Trading Engine compatibility)")
    
    # Alternative field names for Trading Engine compatibility
    stop_loss_price: Optional[float] = Field(None, description="Alternative field name for stop_loss")
    take_profit_price: Optional[float] = Field(None, description="Alternative field name for take_profit")
    entry_type: Optional[str] = Field(None, description="Entry type (MARKET/LIMIT/STOP) - legacy field, use order_kind")
    metadata: Optional[dict] = Field(None, description="Metadata - for compatibility")
    
    @field_validator('symbol')
    @classmethod
    def symbol_uppercase(cls, v: str) -> str:
        return v.upper()
    
    @field_validator('direction')
    @classmethod
    def direction_lowercase(cls, v: str) -> str:
        """Normalize direction to lowercase"""
        return v.lower()
    
    @field_validator('lot_size')
    @classmethod
    def lot_size_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('lot_size must be greater than 0')
        return v
    
    @model_validator(mode='after')
    def validate_fields(self):
        """Validate and normalize fields after model creation"""
        # Normalize order_kind from entry_type if order_kind not provided (backward compatibility)
        if not hasattr(self, 'order_kind') or self.order_kind is None:
            if self.entry_type:
                entry_type_upper = self.entry_type.upper()
                if entry_type_upper == 'MARKET':
                    self.order_kind = 'market'
                elif entry_type_upper == 'LIMIT':
                    self.order_kind = 'limit'
                elif entry_type_upper == 'STOP':
                    self.order_kind = 'stop'
                else:
                    self.order_kind = 'market'  # Default to market
            else:
                self.order_kind = 'market'  # Default to market
        
        # For pending orders (limit/stop), entry_price is required
        if self.order_kind in ('limit', 'stop') and (self.entry_price is None or self.entry_price <= 0):
            raise ValueError(f'entry_price is required for {self.order_kind} orders')
        
        # Use stop_loss_price if stop_loss not provided
        if self.stop_loss is None and self.stop_loss_price is not None:
            self.stop_loss = self.stop_loss_price
        
        # Use take_profit_price if take_profit not provided
        if self.take_profit is None and self.take_profit_price is not None:
            self.take_profit = self.take_profit_price
        
        # Stop loss and take profit are optional (can be None)
        # They will be validated and adjusted in the MT5 client based on symbol constraints
        
        # Use strategy_id if strategy not provided
        if not self.strategy and self.strategy_id:
            self.strategy = self.strategy_id
        if not self.strategy:
            self.strategy = 'low'
        
        return self


class CloseTradeRequest(BaseModel):
    """Request model for closing a trade"""
    ticket: int = Field(..., description="MT5 position ticket ID")
    
    # Also accept mt5_ticket for backward compatibility with Trading Engine
    mt5_ticket: Optional[int] = Field(None, description="Alternative field name for ticket")
    
    reason: Optional[str] = Field(None, description="Reason for closing the trade")
    
    @model_validator(mode='after')
    def validate_ticket(self):
        """Validate and normalize ticket field"""
        # Use mt5_ticket if ticket is 0 or not provided
        if (self.ticket == 0 or self.ticket is None) and self.mt5_ticket is not None:
            self.ticket = self.mt5_ticket
        if self.ticket is None or self.ticket <= 0:
            raise ValueError('ticket must be a positive integer (or provide mt5_ticket)')
        return self


class TradeResponse(BaseModel):
    """Response model for trade operations"""
    success: bool = Field(..., description="Whether the operation succeeded")
    ticket: Optional[int] = Field(None, description="MT5 ticket ID (for open trades)")
    error: Optional[str] = Field(None, description="Error message if operation failed")
    
    # For backward compatibility with Trading Engine
    mt5_ticket: Optional[int] = Field(None, description="Alternative field name for ticket")
    
    def __init__(self, **data):
        super().__init__(**data)
        # Set mt5_ticket = ticket for compatibility
        if self.ticket and not self.mt5_ticket:
            self.mt5_ticket = self.ticket


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(default="ok", description="Service status")
    mt5_connection: bool = Field(..., description="Whether MT5 is connected")
    account_info: Optional[dict] = Field(None, description="MT5 account information if connected")


class OpenPosition(BaseModel):
    """Model for an open position"""
    symbol: str = Field(..., description="Trading symbol (e.g., 'XAUUSD')")
    ticket: int = Field(..., description="MT5 position ticket ID")
    direction: Literal['buy', 'sell'] = Field(..., description="Trade direction")
    volume: float = Field(..., description="Lot size (e.g., 0.10)")
    open_price: float = Field(..., description="Entry price")
    sl: Optional[float] = Field(None, description="Stop loss price")
    tp: Optional[float] = Field(None, description="Take profit price")
    open_time: datetime = Field(..., description="Position open time (ISO 8601)")
    profit: Optional[float] = Field(None, description="Current profit/loss in account currency")


class OpenPositionsResponse(BaseModel):
    """Response model for open positions endpoint"""
    success: bool = Field(..., description="Whether the operation succeeded")
    positions: List[OpenPosition] = Field(default_factory=list, description="List of open positions")
    error: Optional[str] = Field(None, description="Error message if operation failed")


class PendingOrder(BaseModel):
    """Model for a pending order"""
    symbol: str = Field(..., description="Trading symbol (e.g., 'XAUUSD')")
    ticket: int = Field(..., description="MT5 order ticket ID")
    direction: Literal['buy', 'sell'] = Field(..., description="Order direction")
    order_kind: Literal['limit', 'stop'] = Field(..., description="Order type: limit or stop")
    volume: float = Field(..., description="Lot size (e.g., 0.10)")
    entry_price: float = Field(..., description="Pending order price")
    sl: Optional[float] = Field(None, description="Stop loss price")
    tp: Optional[float] = Field(None, description="Take profit price")
    setup_time: str = Field(..., description="Order setup time (ISO 8601)")


class PendingOrdersResponse(BaseModel):
    """Response model for pending orders endpoint"""
    success: bool = Field(..., description="Whether the operation succeeded")
    orders: List[PendingOrder] = Field(default_factory=list, description="List of pending orders")
    error: Optional[str] = Field(None, description="Error message if operation failed")


class CancelOrderRequest(BaseModel):
    """Request model for canceling a pending order"""
    ticket: int = Field(..., description="MT5 order ticket ID")
    mt5_ticket: Optional[int] = Field(None, description="Alternative field name for ticket")
    
    @model_validator(mode='after')
    def validate_ticket(self):
        """Validate and normalize ticket field"""
        if (self.ticket == 0 or self.ticket is None) and self.mt5_ticket is not None:
            self.ticket = self.mt5_ticket
        if self.ticket is None or self.ticket <= 0:
            raise ValueError('ticket must be a positive integer (or provide mt5_ticket)')
        return self


class AccountSummaryResponse(BaseModel):
    """Response model for account summary endpoint"""
    success: bool = Field(..., description="Whether the operation succeeded")
    balance: Optional[float] = Field(None, description="Account balance")
    equity: Optional[float] = Field(None, description="Account equity")
    margin: Optional[float] = Field(None, description="Used margin")
    free_margin: Optional[float] = Field(None, description="Free margin")
    margin_level: Optional[float] = Field(None, description="Margin level (%)")
    currency: Optional[str] = Field(None, description="Account currency")
    error: Optional[str] = Field(None, description="Error message if operation failed")


class ModifyTradeRequest(BaseModel):
    """Request model for modifying SL/TP of a trade"""
    ticket: int = Field(..., description="MT5 position ticket ID")
    stop_loss: Optional[float] = Field(None, description="New stop loss price (None to keep current)")
    take_profit: Optional[float] = Field(None, description="New take profit price (None to keep current)")


class PartialCloseRequest(BaseModel):
    """Request model for partial close of a trade"""
    ticket: int = Field(..., description="MT5 position ticket ID")
    volume_percent: float = Field(..., gt=0, lt=100, description="Percentage of position to close (e.g., 50 = 50%)")
