"""Read model — REAL engine output.

This used to be a synthetic stub that walked fake prices. It now reads the
actual `.gt_state_<SYM>_<CID>.json` / `.gt_live_<SYM>_<CID>.json` files that the
running `run_live.py` bots write into the side directories (GT_LONG_DIR /
GT_SHORT_DIR). No IBKR call here — we only read what the engine already
rendered to disk. That's deliberate: the website surfaces *our system's* truth,
never a direct broker pull (TWS already has its own UI).

The API contract above this is unchanged — `snapshot()` returns the same
`SymbolSnapshot` shape the frontend polls; the field names were designed to
match the on-disk json 1:1, so the mapping is a straight copy.

Launch happens elsewhere: the admin's Approve click stages + runs the command
in tmux (staging.py). `adopt_approved()` here only flips the DB status
APPROVED → LAUNCHED so the MD/Admin UI shows yellow → running; the real
position appears the moment the freshly-launched bot writes its first json.
"""

from __future__ import annotations

import glob
import json
import os
import time
from pathlib import Path

from sqlmodel import Session, select

from . import config
from .models import IntentStatus, LaunchIntent, utcnow
from .schemas import Protective, SnapshotLive, SnapshotState, SymbolSnapshot

# Fields we lift from each json — anything extra on disk is ignored.
# NOTE on real-world json vs the schema:
#   * numeric fields can be `null` (a flat bot has no entry_price/stop_loss) —
#     we omit nulls so the schema's `= 0` default stands.
#   * `cycle_id` on disk is a hex string (e.g. "1630ca08"), not the int the
#     schema models — omitted here; the UI shows the cycle from elsewhere.
_STATE_KEYS = (
    "entry_price", "trigger_price", "stop_loss", "quantity", "pnl",
    "total_commission", "trades_today", "state", "wins", "losses",
    "cycle_seq",   # real cycle number (cycle_id on disk is a hex string)
)
_LIVE_KEYS = (
    "last", "bid", "ask", "high", "low", "vwap", "volume", "buy_pct",
    "equity", "position_notional", "bp_used_pct",
)


def _clean(src: dict, keys) -> dict:
    """Pick `keys` from `src`, dropping missing keys and null values so the
    pydantic schema's defaults apply instead of failing on None."""
    return {k: src[k] for k in keys if src.get(k) is not None}


def _data_dirs() -> list[Path]:
    """Both side dirs, deduped — the site shows every running bot regardless of
    which deployment (LONG/SHORT) wrote it."""
    seen: dict[str, Path] = {}
    for side in ("LONG", "SHORT"):
        d = config.dir_for(side)
        seen[str(d)] = d
    return list(seen.values())


def _read_json(path: str) -> dict:
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


# The entry offset is NOT stored in the state json — it's a launch-time config
# (a constant % for the bot's life), passed as --offset-entry-pct etc. So we
# read it from the running process command line, keyed by (symbol, client_id).
# Cached briefly so we don't walk /proc on every 1.5s poll.
_OFFSET_FLAGS = {
    "--offset-entry-pct": "entry_pct",     # fraction of price (0.001 = 0.1%)
    "--offset-stop-fraction": "stop_fraction",
    "--sl-limit-offset": "sl_limit",       # absolute price buffer
    "--offset-fixed": "fixed",             # absolute price buffer
}
_offset_cache: dict = {"ts": 0.0, "map": {}}


def _bot_offsets() -> dict:
    """{(SYMBOL, client_id): {'offset': float, 'offset_kind': str}} read from the
    running run_live.py command lines. 5s TTL cache."""
    now = time.time()
    if now - _offset_cache["ts"] < 5.0:
        return _offset_cache["map"]
    m: dict = {}
    for cmdpath in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            with open(cmdpath, "rb") as f:
                args = [p.decode("utf-8", "ignore") for p in f.read().split(b"\x00") if p]
        except OSError:
            continue
        if not any(a.endswith("run_live.py") for a in args):
            continue
        i = next((idx for idx, a in enumerate(args) if a.endswith("run_live.py")), -1)
        symbol = next((a.upper() for a in args[i + 1:] if not a.startswith("-")), None)
        cid = None
        offset = 0.0
        kind = ""
        for j, a in enumerate(args):
            nxt = args[j + 1] if j + 1 < len(args) else None
            if a == "--client-id" and nxt:
                try:
                    cid = int(nxt)
                except ValueError:
                    pass
            elif a in _OFFSET_FLAGS and nxt:
                try:
                    offset, kind = float(nxt), _OFFSET_FLAGS[a]
                except ValueError:
                    pass
        if symbol and cid is not None:
            m[(symbol, cid)] = {"offset": offset, "offset_kind": kind}
    _offset_cache["ts"] = now
    _offset_cache["map"] = m
    return m


class Engine:
    """Reads the running bots' json; no in-memory position state of its own."""

    # ── loop step (called by main.engine_loop) ──────────────────────────────
    def adopt_approved(self, session: Session) -> list[str]:
        """APPROVED → LAUNCHED. Status only — the actual launch already happened
        in staging on approve. Returns the symbols flipped (for the ws ping)."""
        rows = session.exec(
            select(LaunchIntent).where(LaunchIntent.status == IntentStatus.APPROVED)
        ).all()
        launched: list[str] = []
        for intent in rows:
            intent.status = IntentStatus.LAUNCHED
            intent.launched_at = utcnow()
            session.add(intent)
            launched.append(intent.symbol)
        if launched:
            session.commit()
        return launched

    def tick(self) -> None:
        """No-op — prices come from the bots' json, not a synthetic walk."""
        return

    # ── read model ───────────────────────────────────────────────────────────
    def snapshot(self) -> list[SymbolSnapshot]:
        """Build one SymbolSnapshot per live state file. `side` comes from the
        source deployment dir — GT_SYSTEM_LONG bots are long, GT_SYSTEM_SHORT
        bots are short (the state json carries no direction field)."""
        out: list[SymbolSnapshot] = []
        offsets = _bot_offsets()
        seen_dirs: set[str] = set()
        for side in ("LONG", "SHORT"):
            d = config.dir_for(side)
            if str(d) in seen_dirs:   # LONG_DIR == SHORT_DIR misconfig → count once
                continue
            seen_dirs.add(str(d))
            for state_path in glob.glob(str(d / ".gt_state_*.json")):
                base = os.path.basename(state_path)  # .gt_state_<SYM>_<CID>.json
                stem = base[len(".gt_state_"):-len(".json")]  # <SYM>_<CID>
                if "_" not in stem:
                    continue
                symbol, cid_str = stem.rsplit("_", 1)
                try:
                    cid = int(cid_str)
                except ValueError:
                    cid = None
                live_path = str(Path(state_path).with_name(f".gt_live_{stem}.json"))

                sj = _read_json(state_path)
                lj = _read_json(live_path)

                state = SnapshotState(**_clean(sj, _STATE_KEYS))
                live = SnapshotLive(**_clean(lj, _LIVE_KEYS))

                spread_bps = 0.0
                if live.last and live.ask and live.bid:
                    spread_bps = round((live.ask - live.bid) / live.last * 10_000, 1)

                off = offsets.get((symbol, cid), {})

                # The real resting protective order — auto-updates as the engine
                # modifies it after a fill (promoted bracket child / trailed stop).
                protective = None
                ps = sj.get("pending_stop")
                if isinstance(ps, dict) and ps.get("stop_price") is not None:
                    protective = Protective(
                        order_id=str(ps.get("order_id") or ""),
                        side=str(ps.get("side") or ""),
                        order_type=str(ps.get("order_type") or ""),
                        stop_price=float(ps.get("stop_price") or 0),
                        limit_price=ps.get("limit_price"),
                        qty=int(ps.get("qty") or 0),
                    )

                out.append(SymbolSnapshot(
                    symbol=symbol, client_id=cid or 0, side=side, spread_bps=spread_bps,
                    offset=off.get("offset", 0.0), offset_kind=off.get("offset_kind", ""),
                    protective=protective, state=state, live=live,
                ))
        out.sort(key=lambda s: s.symbol)
        return out

    @property
    def positions(self) -> dict[str, SymbolSnapshot]:
        """Kept for /api/health (`len(engine.positions)`)."""
        return {s.symbol: s for s in self.snapshot()}


engine = Engine()
