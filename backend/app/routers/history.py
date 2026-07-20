"""GET /api/history/{symbol} — recent price series for the detail-popup chart.

Reads the engine's own feed audit (data/audit/<YYYYMMDD>/<SYM>/feed.csv), which
is the full tick stream (timestamp, ltp, bid, ask, ...). We byte-tail the file
(it can be 100k+ rows), keep the last N minutes, and downsample to a chart-
friendly ~200 points. Lazy: fetched only when a detail popup opens.

Times are returned as Dubai (GST, UTC+4) HH:MM for the axis, matching the rest
of the desk's timestamps.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from .. import config

router = APIRouter(prefix="/api", tags=["history"])

_TAIL_BYTES = 3_000_000   # ~last chunk of the tick file; plenty for 30 min
_MAX_POINTS = 200
_DUBAI = timezone(timedelta(hours=4))


def _feed_path(symbol: str):
    day = datetime.now().strftime("%Y%m%d")
    for side in ("LONG", "SHORT"):
        p = config.dir_for(side) / "data" / "audit" / day / symbol / "feed.csv"
        if p.exists():
            return p
    return None


def _tail_text(path, nbytes: int) -> list[str]:
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        f.seek(max(0, size - nbytes))
        raw = f.read()
    lines = raw.decode("utf-8", "ignore").splitlines()
    # If we seeked into the middle, the first line is partial — drop it.
    return lines[1:] if size > nbytes else lines[1:]  # also drops the header at start-of-file


def _history(symbol: str, minutes: int) -> list[dict]:
    path = _feed_path(symbol)
    if path is None:
        return []
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=minutes)
    pts: list[tuple[datetime, float]] = []
    for line in _tail_text(path, _TAIL_BYTES):
        parts = line.split(",")
        if len(parts) < 3:
            continue
        try:
            ts = datetime.fromisoformat(parts[0].split("+")[0].replace("Z", ""))
            price = float(parts[2])
        except (ValueError, IndexError):
            continue
        if ts < cutoff or price <= 0:
            continue
        pts.append((ts, price))
    if not pts:
        return []
    # downsample evenly to ~_MAX_POINTS
    step = max(1, len(pts) // _MAX_POINTS)
    sampled = pts[::step]
    if pts[-1] is not sampled[-1]:
        sampled.append(pts[-1])   # always keep the latest tick
    return [{"t": (ts + timedelta(hours=4)).strftime("%H:%M"), "price": round(price, 5)}
            for ts, price in sampled]


@router.get("/history/{symbol}")
def history(symbol: str, minutes: int = 30) -> list[dict]:
    return _history(symbol.upper(), minutes)
