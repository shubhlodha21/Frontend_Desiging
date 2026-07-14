"""Persistence model for the launch-approval queue.

An intent is the MD's *request* to deploy a strategy — not an order. It sits in
PENDING_APPROVAL until the desk decides. Only on APPROVED does the engine act,
flipping it to LAUNCHED. This table is the audit trail, so rows are never
mutated destructively: every decision records who made it and when.
"""

from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    # Timezone-aware. The frontend calls Date.parse() on decided_at and compares
    # it to Date.now(), so a naive timestamp would be read as local time and skew
    # the 8s "recently decided" window by the UTC offset.
    return datetime.now(timezone.utc)


class Side(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class Asset(str, Enum):
    EQUITY = "EQUITY"
    FX = "FX"
    CFD = "CFD"


class IntentStatus(str, Enum):
    """The frontend maps these by exact string.

    PENDING_APPROVAL -> "PENDING"; APPROVED/LAUNCHED -> "APPROVED"; anything
    else -> "REJECTED" (see MdScreen.jsx). Renaming a member silently degrades
    to a rejection in the UI.
    """

    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    LAUNCHED = "LAUNCHED"
    REJECTED = "REJECTED"


class LaunchIntent(SQLModel, table=True):
    __tablename__ = "launch_intents"

    id: str = Field(default_factory=_uuid, primary_key=True)
    symbol: str = Field(index=True)
    side: Side
    asset: Asset
    qty: int
    trigger: float
    stop: float
    offset: float | None = None
    paper: bool = True

    status: IntentStatus = Field(default=IntentStatus.PENDING_APPROVAL, index=True)
    submitted_by: str = "md"
    created_at: datetime = Field(default_factory=utcnow)

    decided_by: str | None = None
    decided_at: datetime | None = None
    reject_reason: str | None = None

    launched_at: datetime | None = None

    # ── staging (see staging.py) ────────────────────────────────────────────
    # client_id is allocated from a per-side range at approval and HELD until
    # released. IBKR rejects duplicate ids on concurrent connections, so this
    # column is the source of truth for what's in use — never reuse one while
    # its strategy is still running.
    client_id: int | None = Field(default=None, index=True)
    client_id_released: bool = False

    # The exact command staged into tmux, stored verbatim. This is the audit
    # record of what a human was asked to run — keep it even after the window
    # is gone.
    staged_command: str | None = None
    staged_window: str | None = None
    staged_at: datetime | None = None
    staging_error: str | None = None
