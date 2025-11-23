"""
Utility functions for logging and error handling
"""
import logging
import sys
from typing import Any, Dict

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger('MT5Connector')


def log_mt5_error(operation: str, error_code: int, error_message: str = '', context: Dict[str, Any] = None):
    """Log MT5 operation errors with full context"""
    log_data = {
        'operation': operation,
        'error_code': error_code,
        'error_message': error_message,
        **(context or {})
    }
    logger.error(f"MT5 {operation} failed: {error_message} (code: {error_code})", extra=log_data)


def log_trade_success(operation: str, ticket: int, context: Dict[str, Any] = None):
    """Log successful trade operations"""
    log_data = {
        'operation': operation,
        'ticket': ticket,
        **(context or {})
    }
    logger.info(f"MT5 {operation} succeeded: ticket {ticket}", extra=log_data)


def log_mt5_connection(status: bool, details: str = ''):
    """Log MT5 connection status"""
    if status:
        logger.info(f"MT5 connection established: {details}")
    else:
        logger.error(f"MT5 connection failed: {details}")

