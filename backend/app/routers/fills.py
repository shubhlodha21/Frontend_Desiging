"""GET /api/fills/{symbol} — execution history for the Trades Sheet.

Reads the engine's own order audit — `data/audit/<YYYYMMDD>/<SYM>/order.csv`,
FILLED rows only — walking back across day partitions in both side dirs. This
is *our system's* audit trail, not a broker pull.

Lazy on purpose: the detail popup fetches this only when it opens, so it stays
off the 1.5s snapshot poll path. The row shape matches what the frontend's
Trades Sheet renders (ts/side/type/qty/price/slippageBp/commission/exchange/
orderId/pnl).
"""
from __future__ import annotations

import csv
from datetime import date, timedelta

from fastapi import APIRouter

from .. import config

router = APIRouter(prefix="/api", tags=["fills"])

_MAX_DAYS = 14  # how far back to walk the day partitions


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _read_symbol_fills(symbol: str, n: int) -> list[dict]:
    dirs = {str(config.dir_for(s)): config.dir_for(s) for s in ("LONG", "SHORT")}
    today = date.today()
    rows: list[dict] = []
    for base in dirs.values():
        for days_back in range(_MAX_DAYS):
            ds = (today - timedelta(days=days_back)).strftime("%Y%m%d")
            path = base / "data" / "audit" / ds / symbol / "order.csv"
            if not path.exists():
                continue
            try:
                with open(path, newline="") as fh:
                    for r in csv.DictReader(fh):
                        if r.get("event") != "FILLED":
                            continue
                        fill = _f(r.get("fill_price"))
                        slip = _f(r.get("slippage"))
                        rows.append({
                            "ts": r.get("timestamp"),
                            "side": r.get("side"),
                            "type": r.get("order_type") or "",
                            "tif": "",                       # not carried in order.csv
                            "qty": int(_f(r.get("qty"))),
                            "price": fill,
                            "slippageBp": round(slip / fill * 10_000, 1) if fill else 0.0,
                            "commission": _f(r.get("commission")),
                            "exchange": r.get("exchange") or "",
                            "orderId": r.get("order_id") or "",
                            "pnl": _f(r.get("pnl")),
                        })
            except Exception:
                continue
    rows.sort(key=lambda x: x["ts"] or "")   # chronological
    return rows[-n:]


@router.get("/fills/{symbol}")
def fills(symbol: str, n: int = 40) -> list[dict]:
    return _read_symbol_fills(symbol.upper(), n)
