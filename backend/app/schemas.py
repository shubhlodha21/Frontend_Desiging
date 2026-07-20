"""Request/response shapes.

These mirror what the frontend already sends and reads (src/lib/liveFeed.js and
src/MdScreen.jsx). Field names are part of the contract — the React code indexes
them directly, so a rename here silently blanks a panel there.
"""

import re
from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer, field_validator

from .models import Asset, IntentStatus, Side

# An approved intent is interpolated into a shell command that gets typed into a
# tmux pane (see staging.py), so `symbol` reaches a shell. Values are also
# shlex.quote()'d there, but validate at the edge too — defence in depth, and a
# bad symbol should be a 422 at submit, not a mystery at approval.
#
# Covers real tickers (BRK.B, RDS-A, EURUSD, IBUS500) and nothing else: no
# spaces, semicolons, quotes, backticks, $, or newlines.
SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,11}$")


class LaunchIntentCreate(BaseModel):
    """Body posted by submitLaunchIntent() in src/lib/liveFeed.js."""

    symbol: str
    side: Side
    asset: Asset = Asset.EQUITY
    qty: int = Field(ge=1)
    trigger: float = Field(gt=0)
    stop: float = Field(gt=0, le=0.99)
    offset: float | None = None
    paper: bool = True

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("symbol is required")
        if not SYMBOL_RE.match(v):
            raise ValueError(
                "symbol must be 1-12 chars: A-Z, 0-9, dot or hyphen, starting with a letter"
            )
        return v


class LaunchIntentRead(BaseModel):
    """Returned from POST and GET /api/launch-intents.

    The MD poller reads id/symbol/side/qty/status/decided_at; the admin queue
    uses the rest. decided_at serialises as tz-aware ISO 8601, which is what
    Date.parse() on the frontend needs.
    """

    id: str
    symbol: str
    side: Side
    asset: Asset
    qty: int
    trigger: float
    stop: float
    offset: float | None
    paper: bool
    status: IntentStatus
    submitted_by: str
    created_at: datetime
    decided_by: str | None
    decided_at: datetime | None
    reject_reason: str | None
    launched_at: datetime | None

    # staging
    client_id: int | None = None
    client_id_released: bool = False
    staged_command: str | None = None
    staged_window: str | None = None
    staged_at: datetime | None = None
    staging_error: str | None = None

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "decided_at", "launched_at", "staged_at")
    def _as_utc_iso(self, dt: datetime | None) -> str | None:
        """Force a UTC offset onto every timestamp.

        SQLite has no timezone type, so tz-aware values written by utcnow() come
        back naive. Emitted bare, `Date.parse()` reads them as *local* time
        (ECMA-262 treats an offset-less date-time as local), which in Dubai
        (UTC+4) makes a fresh decision look 4h old — past the frontend's 8s
        "recently decided" window, so approvals would never surface. Stored
        values are always UTC; label them as such on the way out.
        """
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()


class RejectBody(BaseModel):
    reason: str | None = None


# ── /api/snapshot ───────────────────────────────────────────────────────────
# Shape consumed by mapPosition()/buildMd() in src/lib/liveFeed.js. Every field
# below is read there; the frontend fills gaps with 0 rather than crashing, so
# a missing key shows as an empty cell instead of an error.


class SnapshotState(BaseModel):
    entry_price: float = 0
    trigger_price: float = 0
    cycle_seq: int = 1
    stop_loss: float = 0
    quantity: int = 0
    pnl: float = 0
    total_commission: float = 0
    trades_today: int = 0
    state: str = "MONITORING"  # MONITORING | IN_POSITION | WAITING_REENTRY | ORDER_ENTRY
    cycle_id: int = 1
    wins: int = 0
    losses: int = 0


class SnapshotLive(BaseModel):
    last: float = 0
    bid: float = 0
    ask: float = 0
    high: float = 0
    low: float = 0
    vwap: float = 0
    volume: float = 0
    buy_pct: float = 50
    equity: float = 0
    position_notional: float = 0
    bp_used_pct: float = 0


class Protective(BaseModel):
    """The resting protective exit order (SELL for a long, BUY-cover for a
    short), read from the engine's `pending_stop`. Auto-updates as the engine
    modifies it after a fill (trailed stop / promoted bracket child)."""
    order_id: str = ""
    side: str = ""
    order_type: str = ""
    stop_price: float = 0
    limit_price: float | None = None
    qty: int = 0


class SymbolSnapshot(BaseModel):
    symbol: str
    client_id: int = 0          # IBKR client-id — targets the exact bot for cancel
    side: str = "LONG"          # LONG | SHORT — from the source deployment dir
    spread_bps: float = 0
    offset: float = 0           # launch-time entry offset (--offset-entry-pct etc.)
    offset_kind: str = ""       # entry_pct | stop_fraction | sl_limit | fixed
    protective: Protective | None = None
    state: SnapshotState
    live: SnapshotLive
