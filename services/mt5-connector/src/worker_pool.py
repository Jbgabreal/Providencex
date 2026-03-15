"""
Multi-Account Worker Pool for Parallel MT5 Trade Execution

The MetaTrader5 Python library only supports ONE connection per PROCESS.
For parallel execution across N accounts, we spawn N worker processes,
each with its own MT5 terminal connection.

Architecture:
  FastAPI (main process)
    ├── Worker 1 (subprocess) → MT5 Terminal → Account A
    ├── Worker 2 (subprocess) → MT5 Terminal → Account B
    └── Worker N (subprocess) → MT5 Terminal → Account N

Each worker:
  - Connects to the shared MT5 terminal (or its own portable copy)
  - Stays logged into its assigned account
  - Listens for trade commands on a multiprocessing Queue
  - Returns results via a response Queue

Trade signal flow:
  1. Trading Engine sends trade requests for all accounts
  2. FastAPI dispatches to workers IN PARALLEL
  3. All workers execute simultaneously
  4. Results collected and returned
"""

import multiprocessing as mp
import MetaTrader5 as mt5
import time
import json
import logging
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

logger = logging.getLogger("WorkerPool")


@dataclass
class WorkerCommand:
    """Command sent to a worker process."""
    action: str  # 'open_trade', 'close_trade', 'get_balance', 'health', 'shutdown'
    payload: Dict[str, Any]
    request_id: str


@dataclass
class WorkerResult:
    """Result from a worker process."""
    request_id: str
    success: bool
    data: Dict[str, Any]
    error: Optional[str] = None


def worker_process(
    worker_id: int,
    login: int,
    password: str,
    server: str,
    terminal_path: Optional[str],
    command_queue: mp.Queue,
    result_queue: mp.Queue,
):
    """
    Worker process — owns one MT5 connection, stays logged into one account.
    Runs in a loop processing commands from the queue.
    """
    proc_logger = logging.getLogger(f"MT5Worker-{worker_id}")
    logging.basicConfig(level=logging.INFO, format=f"[Worker-{worker_id}] %(message)s")

    # Initialize MT5
    if terminal_path:
        initialized = mt5.initialize(path=terminal_path)
    else:
        initialized = mt5.initialize()

    if not initialized:
        err = mt5.last_error()
        proc_logger.error(f"MT5 init failed: {err}")
        result_queue.put(WorkerResult(
            request_id="init",
            success=False,
            data={},
            error=f"MT5 init failed: {err}",
        ))
        return

    # Login
    authorized = mt5.login(login=login, password=password, server=server)
    if not authorized:
        err = mt5.last_error()
        proc_logger.error(f"MT5 login failed for {login}: {err}")
        mt5.shutdown()
        result_queue.put(WorkerResult(
            request_id="init",
            success=False,
            data={},
            error=f"Login failed for {login}: {err}",
        ))
        return

    account_info = mt5.account_info()
    proc_logger.info(f"Connected: {login} @ {server}, balance={account_info.balance if account_info else '?'}")

    # Process commands
    while True:
        try:
            cmd_data = command_queue.get(timeout=30)
            cmd = WorkerCommand(**cmd_data) if isinstance(cmd_data, dict) else cmd_data

            if cmd.action == 'shutdown':
                proc_logger.info("Shutting down")
                mt5.shutdown()
                return

            elif cmd.action == 'open_trade':
                result = _execute_open_trade(cmd.payload)
                result_queue.put(WorkerResult(
                    request_id=cmd.request_id,
                    success=result.get('success', False),
                    data=result,
                    error=result.get('error'),
                ))

            elif cmd.action == 'close_trade':
                result = _execute_close_trade(cmd.payload)
                result_queue.put(WorkerResult(
                    request_id=cmd.request_id,
                    success=result.get('success', False),
                    data=result,
                    error=result.get('error'),
                ))

            elif cmd.action == 'get_balance':
                info = mt5.account_info()
                result_queue.put(WorkerResult(
                    request_id=cmd.request_id,
                    success=info is not None,
                    data={
                        'balance': info.balance if info else 0,
                        'equity': info.equity if info else 0,
                        'currency': info.currency if info else 'USD',
                    },
                ))

            elif cmd.action == 'health':
                info = mt5.account_info()
                result_queue.put(WorkerResult(
                    request_id=cmd.request_id,
                    success=info is not None,
                    data={'login': login, 'connected': info is not None},
                ))

        except mp.queues.Empty:
            # Keepalive — verify connection
            if mt5.account_info() is None:
                proc_logger.warning("Connection lost, reconnecting...")
                mt5.initialize(path=terminal_path) if terminal_path else mt5.initialize()
                mt5.login(login=login, password=password, server=server)
            continue
        except Exception as e:
            proc_logger.error(f"Worker error: {e}")
            continue


def _execute_open_trade(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a trade within the worker process (has active MT5 connection)."""
    symbol = payload['symbol']
    direction = payload['direction'].lower()
    lot_size = payload['lot_size']
    sl = payload.get('stop_loss')
    tp = payload.get('take_profit')
    order_kind = payload.get('order_kind', 'market')
    entry_price = payload.get('entry_price')

    # Validate symbol
    info = mt5.symbol_info(symbol)
    if info is None:
        return {'success': False, 'error': f'Symbol {symbol} not found'}

    if not info.visible:
        mt5.symbol_select(symbol, True)

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return {'success': False, 'error': f'No tick data for {symbol}'}

    # Build order request
    order_type = mt5.ORDER_TYPE_BUY if direction == 'buy' else mt5.ORDER_TYPE_SELL
    price = tick.ask if direction == 'buy' else tick.bid

    request = {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': symbol,
        'volume': lot_size,
        'type': order_type,
        'price': price,
        'deviation': 20,
        'magic': 123456,
        'comment': 'ProvidenceX',
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_RETURN,
    }

    if sl and sl > 0:
        request['sl'] = sl
    if tp and tp > 0:
        request['tp'] = tp

    result = mt5.order_send(request)
    if result is None:
        err = mt5.last_error()
        return {'success': False, 'error': f'order_send returned None: {err}'}

    if result.retcode == mt5.TRADE_RETCODE_DONE:
        return {
            'success': True,
            'ticket': result.order,
            'price': result.price,
            'volume': result.volume,
        }
    else:
        return {
            'success': False,
            'error': f'Order failed: {result.retcode} - {result.comment}',
        }


def _execute_close_trade(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Close a position within the worker process."""
    ticket = payload['ticket']

    position = mt5.positions_get(ticket=ticket)
    if not position:
        return {'success': False, 'error': f'Position {ticket} not found'}

    pos = position[0]
    close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    tick = mt5.symbol_info_tick(pos.symbol)
    if tick is None:
        return {'success': False, 'error': f'No tick for {pos.symbol}'}

    price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

    request = {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': pos.symbol,
        'volume': pos.volume,
        'type': close_type,
        'position': ticket,
        'price': price,
        'deviation': 20,
        'magic': 123456,
        'comment': 'ProvidenceX close',
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_RETURN,
    }

    result = mt5.order_send(request)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        return {'success': True, 'ticket': ticket}
    else:
        err = result.comment if result else str(mt5.last_error())
        return {'success': False, 'error': f'Close failed: {err}'}


class MT5WorkerPool:
    """
    Manages a pool of MT5 worker processes.
    Each worker stays logged into one account for instant parallel execution.
    """

    def __init__(self, default_terminal_path: Optional[str] = None):
        self._workers: Dict[int, Dict[str, Any]] = {}  # login → worker info
        self._default_terminal_path = default_terminal_path
        self._lock = threading.Lock()
        self._request_counter = 0

    def register_account(
        self,
        login: int,
        password: str,
        server: str,
        terminal_path: Optional[str] = None,
    ) -> bool:
        """Spawn a worker process for this account (if not already running)."""
        with self._lock:
            if login in self._workers:
                return True  # Already running

            cmd_queue = mp.Queue()
            res_queue = mp.Queue()

            proc = mp.Process(
                target=worker_process,
                args=(
                    len(self._workers),
                    login,
                    password,
                    server,
                    terminal_path or self._default_terminal_path,
                    cmd_queue,
                    res_queue,
                ),
                daemon=True,
            )
            proc.start()

            # Wait for init result
            try:
                init_result = res_queue.get(timeout=15)
                if not init_result.success:
                    logger.error(f"Worker for {login} failed to start: {init_result.error}")
                    proc.terminate()
                    return False
            except mp.queues.Empty:
                pass  # No error = success (worker is running)

            self._workers[login] = {
                'process': proc,
                'cmd_queue': cmd_queue,
                'res_queue': res_queue,
                'login': login,
                'server': server,
            }

            logger.info(f"Worker spawned for account {login} @ {server} (PID: {proc.pid})")
            return True

    def execute_trade(
        self,
        login: int,
        action: str,
        payload: Dict[str, Any],
        timeout: float = 15.0,
    ) -> Dict[str, Any]:
        """Send a trade command to a specific account's worker."""
        worker = self._workers.get(login)
        if not worker:
            return {'success': False, 'error': f'No worker for account {login}'}

        with self._lock:
            self._request_counter += 1
            request_id = f"req-{self._request_counter}"

        cmd = {
            'action': action,
            'payload': payload,
            'request_id': request_id,
        }
        worker['cmd_queue'].put(cmd)

        # Wait for result
        try:
            result = worker['res_queue'].get(timeout=timeout)
            return result.data if result.success else {'success': False, 'error': result.error}
        except mp.queues.Empty:
            return {'success': False, 'error': f'Worker timeout for account {login}'}

    def execute_trade_all(
        self,
        action: str,
        payload: Dict[str, Any],
        logins: Optional[List[int]] = None,
        timeout: float = 15.0,
    ) -> Dict[int, Dict[str, Any]]:
        """
        Execute the SAME trade across ALL registered accounts IN PARALLEL.
        Returns: {login: result} for each account.
        """
        target_logins = logins or list(self._workers.keys())
        results: Dict[int, Dict[str, Any]] = {}

        # Send commands to all workers simultaneously
        request_ids: Dict[int, str] = {}
        with self._lock:
            for login in target_logins:
                worker = self._workers.get(login)
                if not worker:
                    results[login] = {'success': False, 'error': f'No worker for {login}'}
                    continue

                self._request_counter += 1
                req_id = f"req-{self._request_counter}"
                request_ids[login] = req_id

                worker['cmd_queue'].put({
                    'action': action,
                    'payload': payload,
                    'request_id': req_id,
                })

        # Collect results from all workers
        deadline = time.time() + timeout
        for login in target_logins:
            if login in results:
                continue  # Already have error result
            worker = self._workers.get(login)
            if not worker:
                continue

            remaining = max(0.1, deadline - time.time())
            try:
                result = worker['res_queue'].get(timeout=remaining)
                results[login] = result.data if result.success else {'success': False, 'error': result.error}
            except mp.queues.Empty:
                results[login] = {'success': False, 'error': 'Worker timeout'}

        return results

    @property
    def active_accounts(self) -> List[int]:
        return list(self._workers.keys())

    @property
    def worker_count(self) -> int:
        return len(self._workers)

    def shutdown(self):
        """Shut down all workers."""
        for login, worker in self._workers.items():
            try:
                worker['cmd_queue'].put({
                    'action': 'shutdown',
                    'payload': {},
                    'request_id': 'shutdown',
                })
                worker['process'].join(timeout=5)
                if worker['process'].is_alive():
                    worker['process'].terminate()
            except Exception as e:
                logger.error(f"Error shutting down worker {login}: {e}")
        self._workers.clear()
        logger.info("All workers shut down")


# Singleton
_pool: Optional[MT5WorkerPool] = None


def get_worker_pool() -> MT5WorkerPool:
    global _pool
    if _pool is None:
        raise RuntimeError("WorkerPool not initialized")
    return _pool


def init_worker_pool(default_terminal_path: Optional[str] = None) -> MT5WorkerPool:
    global _pool
    _pool = MT5WorkerPool(default_terminal_path=default_terminal_path)
    return _pool
