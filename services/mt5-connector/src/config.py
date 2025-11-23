"""
MT5 Connector Configuration
Loads environment variables for MT5 connection and FastAPI settings.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from ROOT of monorepo (NOT from mt5-connector service directory)
# Path calculation from services/mt5-connector/src/config.py to root:
#   config.py is in: services/mt5-connector/src/
#   .parent                    -> services/mt5-connector/src/
#   .parent.parent             -> services/mt5-connector/
#   .parent.parent.parent      -> services/
#   .parent.parent.parent.parent -> root/ (where .env lives)
root_dir = Path(__file__).parent.parent.parent.parent
env_path = root_dir / '.env'

# Log the path being used for debugging (INFO level so it's visible)
import logging
logger = logging.getLogger(__name__)
logger.info(f"Loading .env from ROOT: {env_path.absolute()} (exists: {env_path.exists()})")

if not env_path.exists():
    logger.warning(f"⚠️  .env file NOT FOUND at {env_path.absolute()}")
    logger.warning("Make sure MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_PATH are set in root .env file")

load_dotenv(dotenv_path=env_path, override=True)


class MT5Config:
    """Configuration for MT5 connection"""
    
    def __init__(self):
        # Load with .strip() to handle any whitespace after = in .env file
        login_str = os.getenv('MT5_LOGIN', '0').strip()
        self.login = int(login_str) if login_str else 0
        self.password = os.getenv('MT5_PASSWORD', '').strip()
        self.server = os.getenv('MT5_SERVER', '').strip()
        # Remove quotes and normalize path
        path_str = os.getenv('MT5_PATH', '').strip().strip('"').strip("'")
        self.path = path_str if path_str else None  # Use None if empty, not empty string
        self.fastapi_port = int(os.getenv('FASTAPI_PORT', '3030').strip())
        
        # Trading Engine webhook URL for order events (v3)
        self.trading_engine_order_webhook_url = os.getenv('TRADING_ENGINE_ORDER_WEBHOOK_URL', '').strip()
        
        # Historical backfill default days
        self.historical_backfill_default_days = int(os.getenv('HISTORICAL_BACKFILL_DEFAULT_DAYS', '90').strip())
        
        # Validate path if provided
        if self.path:
            path_obj = Path(self.path)
            if not path_obj.exists():
                logger.warning(f"⚠️  MT5_PATH file does not exist: {self.path}")
                logger.warning("   MT5 will try to auto-detect the terminal location or may fail")
                logger.warning("   If MT5 is installed, check the path in your .env file")
                # Don't set to None - let MT5 try and fail with better error message
            else:
                logger.info(f"✓ MT5_PATH file exists: {self.path}")
        else:
            logger.info("MT5_PATH not set - MT5 will auto-detect terminal location")
        
        # Log loaded values (without password) - INFO level so it's visible at startup
        logger.info(f"Loaded MT5 config from ROOT .env: login={self.login}, server='{self.server}', "
                   f"path='{self.path}', port={self.fastapi_port}, password_set={bool(self.password)}")
        
        if not self.validate():
            logger.warning("⚠️  MT5 credentials are INVALID or MISSING!")
            logger.warning("   Required: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER in root .env file")
    
    def validate(self) -> bool:
        """Validate that required MT5 credentials are set"""
        if not self.login or self.login == 0:
            return False
        if not self.password:
            return False
        if not self.server:
            return False
        return True
    
    def get_config_dict(self) -> dict:
        """Get configuration as dictionary for logging (without password)"""
        return {
            'login': self.login,
            'server': self.server,
            'path': self.path if self.path else 'default',
            'fastapi_port': self.fastapi_port,
            'password_set': bool(self.password),
        }

