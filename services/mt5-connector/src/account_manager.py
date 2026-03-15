"""
Multi-Account MT5 Connection Manager

The MetaTrader5 Python library only supports ONE active connection per process.
This manager handles switching between accounts using a threading lock to ensure
only one account is active at a time.

Flow per request:
  1. Acquire lock
  2. If current account != requested account: mt5.shutdown() → mt5.initialize() → mt5.login()
  3. Execute the operation
  4. Release lock (do NOT shutdown — keep connection for potential reuse)

For 20 accounts on 60-second tick intervals: 20 × ~1.5s switch = 30s, well within cycle.
"""

import threading
import MetaTrader5 as mt5
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass
from .utils import logger


@dataclass
class AccountCredentials:
    login: int
    password: str
    server: str
    terminal_path: Optional[str] = None


class MT5AccountManager:
    """Manages MT5 connections across multiple accounts with safe sequential access."""

    def __init__(self, default_terminal_path: Optional[str] = None):
        self._lock = threading.Lock()
        self._current_account: Optional[int] = None  # login of currently connected account
        self._default_terminal_path = default_terminal_path
        self._initialized = False

    @property
    def current_account(self) -> Optional[int]:
        return self._current_account

    def execute_for_account(
        self,
        credentials: AccountCredentials,
        operation: callable,
    ) -> Any:
        """
        Execute an operation for a specific account.
        Handles login switching if needed. Thread-safe.

        Args:
            credentials: Account login/password/server
            operation: Callable that performs the MT5 operation (called while lock is held)

        Returns:
            Whatever the operation returns
        """
        with self._lock:
            # Switch account if needed
            if self._current_account != credentials.login:
                success, msg = self._switch_account(credentials)
                if not success:
                    raise ConnectionError(f"Failed to switch to account {credentials.login}: {msg}")

            # Verify connection is alive
            account_info = mt5.account_info()
            if account_info is None:
                # Connection lost, try reconnecting
                logger.warning(f"[AccountManager] Connection lost for {credentials.login}, reconnecting...")
                success, msg = self._switch_account(credentials)
                if not success:
                    raise ConnectionError(f"Failed to reconnect to account {credentials.login}: {msg}")

            # Execute the operation
            return operation()

    def _switch_account(self, credentials: AccountCredentials) -> Tuple[bool, str]:
        """Switch MT5 connection to a different account."""
        # Shutdown existing connection
        if self._initialized:
            logger.info(f"[AccountManager] Switching from account {self._current_account} to {credentials.login}")
            mt5.shutdown()
            self._initialized = False
            self._current_account = None

        # Initialize MT5 terminal
        terminal_path = credentials.terminal_path or self._default_terminal_path
        if terminal_path:
            from pathlib import Path
            if Path(terminal_path).exists():
                initialized = mt5.initialize(path=terminal_path)
            else:
                logger.warning(f"[AccountManager] Terminal path not found: {terminal_path}, trying auto-detect")
                initialized = mt5.initialize()
        else:
            initialized = mt5.initialize()

        if not initialized:
            error_code, error_desc = mt5.last_error()
            return False, f"mt5.initialize() failed: {error_code} - {error_desc}"

        self._initialized = True

        # Login to account
        authorized = mt5.login(
            login=credentials.login,
            password=credentials.password,
            server=credentials.server,
        )

        if not authorized:
            error_code, error_desc = mt5.last_error()
            mt5.shutdown()
            self._initialized = False
            return False, f"mt5.login() failed for {credentials.login}: {error_code} - {error_desc}"

        self._current_account = credentials.login
        account_info = mt5.account_info()
        logger.info(
            f"[AccountManager] Connected to account {credentials.login} @ {credentials.server} "
            f"(balance: {account_info.balance if account_info else '?'})"
        )
        return True, "OK"

    def connect_default(self, credentials: AccountCredentials) -> Tuple[bool, str]:
        """Connect to the default/admin account at startup."""
        with self._lock:
            return self._switch_account(credentials)

    def shutdown(self):
        """Shutdown MT5 connection."""
        with self._lock:
            if self._initialized:
                mt5.shutdown()
                self._initialized = False
                self._current_account = None
                logger.info("[AccountManager] MT5 shutdown complete")


# Singleton instance
account_manager: Optional[MT5AccountManager] = None


def get_account_manager() -> MT5AccountManager:
    global account_manager
    if account_manager is None:
        raise RuntimeError("AccountManager not initialized. Call init_account_manager() first.")
    return account_manager


def init_account_manager(default_terminal_path: Optional[str] = None) -> MT5AccountManager:
    global account_manager
    account_manager = MT5AccountManager(default_terminal_path=default_terminal_path)
    return account_manager
