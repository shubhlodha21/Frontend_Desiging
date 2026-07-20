"""POST /api/cancel/{symbol} — cancel a bot: stop it + wipe its 4 state files.

"Cancel" = take the strategy off the board. We must kill the run_live.py process
FIRST (it rewrites its json ~5x/sec, so deleting while it runs is futile), then
remove its four artifacts across both side dirs:

    .gt_state_<SYM>_<CID>.json
    .gt_live_<SYM>_<CID>.json
    .gt_fills_<SYM>_<CID>.jsonl
    .gt_lock_<SYM>_<PORT>.lock

NOTE (broker side): this stops the bot and clears LOCAL state. It does NOT cancel
resting orders at IBKR — a killed bot can leave its entry/stop orders working at
the broker. Cancelling those is the broker/flatten path (the square-off work that
is deliberately deferred for now).
"""
from __future__ import annotations

import asyncio
import glob
import os
import signal
import time

from fastapi import APIRouter

from .. import config

router = APIRouter(prefix="/api", tags=["control"])


def _running_pids(symbol: str, client_id: int | None) -> list[int]:
    pids: list[int] = []
    for cmdpath in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            pid = int(cmdpath.split("/")[2])
            args = [p.decode("utf-8", "ignore") for p in open(cmdpath, "rb").read().split(b"\x00") if p]
        except (OSError, ValueError):
            continue
        i = next((k for k, a in enumerate(args) if a.endswith("run_live.py")), -1)
        if i < 0:
            continue
        sym = next((a.upper() for a in args[i + 1:] if not a.startswith("-")), None)
        if sym != symbol:
            continue
        if client_id is not None and f"{client_id}" not in _flag(args, "--client-id"):
            continue
        pids.append(pid)
    return pids


def _flag(args: list[str], flag: str) -> str:
    for k, a in enumerate(args):
        if a == flag and k + 1 < len(args):
            return args[k + 1]
    return ""


def _kill(pids: list[int]) -> list[int]:
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    if pids:
        time.sleep(1.5)                      # let it flush + release the lock
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)  # SIGKILL survivors
            except OSError:
                pass                          # already gone
    return pids


def _clear_files(symbol: str, client_id: int | None) -> list[str]:
    deleted: list[str] = []
    cid = "*" if client_id is None else str(client_id)
    patterns = [
        f".gt_state_{symbol}_{cid}.json",
        f".gt_live_{symbol}_{cid}.json",
        f".gt_fills_{symbol}_{cid}.jsonl",
        f".gt_lock_{symbol}_*.lock",   # lock is keyed by symbol+port, not cid
    ]
    for d in (config.dir_for("LONG"), config.dir_for("SHORT")):
        for pat in patterns:
            for f in glob.glob(str(d / pat)):
                try:
                    os.remove(f)
                    deleted.append(os.path.basename(f))
                except OSError:
                    pass
    return deleted


def _contract_names(c) -> set[str]:
    """The ways a contract's ticker can appear, so we match FX/CFD/stock alike:
    AAPL → {AAPL}; GBP.USD → {GBP, GBPUSD}; index CFDs via localSymbol."""
    s = (getattr(c, "symbol", "") or "").upper()
    cur = (getattr(c, "currency", "") or "").upper()
    ls = (getattr(c, "localSymbol", "") or "").replace(".", "").replace(" ", "").upper()
    return {s, s + cur, ls}


async def _cancel_broker_orders(symbol: str, port: int) -> int:
    """Best-effort: connect on a SPARE client_id, pull ALL open orders, and cancel
    the ones for this ticker. Using a spare id avoids the 'client id in use' wall
    that hits when reconnecting as the just-killed bot's own id. Returns count, or
    -1 if we couldn't connect. Never raises."""
    try:
        from ib_async import IB
    except ImportError:
        return -1
    ib = IB()
    spare = int(os.environ.get("GT_WEBAPP_IB_CID", "951"))
    try:
        try:
            await asyncio.wait_for(ib.connectAsync("127.0.0.1", port, clientId=spare), timeout=8)
        except Exception:
            return -1
        try:
            await ib.reqAllOpenOrdersAsync()
        except Exception:
            pass
        await asyncio.sleep(0.8)
        n = 0
        for t in ib.openTrades():
            if symbol in _contract_names(t.contract) and \
               t.orderStatus.status not in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
                ib.cancelOrder(t.order)
                n += 1
        if n:
            await asyncio.sleep(1.2)        # let the cancels land
        return n
    except Exception:
        return -1
    finally:
        try:
            ib.disconnect()
        except Exception:
            pass


@router.post("/cancel/{symbol}")
async def cancel(symbol: str, client_id: int | None = None) -> dict:
    sym = symbol.upper()
    killed = await asyncio.to_thread(_kill, _running_pids(sym, client_id))
    port = int(os.environ.get("GT_IB_PORT_PAPER", "7497"))
    cancelled = await _cancel_broker_orders(sym, port)
    deleted = await asyncio.to_thread(_clear_files, sym, client_id)
    return {"ok": True, "symbol": sym, "killed": killed,
            "orders_cancelled": cancelled, "deleted": deleted}
