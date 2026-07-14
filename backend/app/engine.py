"""Execution engine — STUB.

Stands in for the real run_live.py / IBKR bridge. It does two things:

  1. Adopts APPROVED intents: marks them LAUNCHED and opens a tracked position.
     This is the step that closes the loop — approve on the admin screen and the
     symbol shows up in /api/snapshot within a second.
  2. Walks prices so the UI has something live to render.

Everything here is in-memory and synthetic. Replace `_tick()` with real market
data and `adopt_approved()` with real order placement; the API contract above it
does not change.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from sqlmodel import Session, select

from .models import IntentStatus, LaunchIntent, Side, utcnow
from .schemas import SnapshotLive, SnapshotState, SymbolSnapshot

START_EQUITY = 1_000_000.0


def _seed_price(symbol: str, asset: str) -> float:
    """Plausible starting price per asset class (mirrors mdData.js priceFor)."""
    if asset == "FX":
        return random.uniform(0.62, 1.42)
    if asset == "CFD" and symbol.startswith("IB"):
        return random.uniform(7000, 30000)
    return random.uniform(95, 620)


@dataclass
class Position:
    symbol: str
    asset: str
    side: Side
    qty: int
    entry: float
    stop: float
    last: float
    high: float
    low: float
    cycle: int = 1
    trades_today: int = 1
    wins: int = 0
    losses: int = 0
    commission: float = 0.0
    _vol: float = field(default_factory=lambda: random.uniform(2e5, 9e6))

    @property
    def dp(self) -> int:
        return 4 if self.asset == "FX" else 2

    @property
    def notional_qty(self) -> float:
        # FX is quoted per 1k units; everything else is 1:1.
        return self.qty / 1000 if self.asset == "FX" else self.qty

    @property
    def pnl(self) -> float:
        direction = 1 if self.side == Side.LONG else -1
        return direction * (self.last - self.entry) * self.notional_qty

    @property
    def notional(self) -> float:
        return abs(self.last * self.notional_qty)


class Engine:
    def __init__(self) -> None:
        self.positions: dict[str, Position] = {}

    # ── loop step ───────────────────────────────────────────────────────────
    def adopt_approved(self, session: Session) -> list[str]:
        """APPROVED -> LAUNCHED, opening a position for each. Returns symbols."""
        rows = session.exec(
            select(LaunchIntent).where(LaunchIntent.status == IntentStatus.APPROVED)
        ).all()
        launched: list[str] = []
        for intent in rows:
            if intent.symbol not in self.positions:
                self.positions[intent.symbol] = self._open(intent)
            intent.status = IntentStatus.LAUNCHED
            intent.launched_at = utcnow()
            session.add(intent)
            launched.append(intent.symbol)
        if launched:
            session.commit()
        return launched

    def _open(self, intent: LaunchIntent) -> Position:
        asset = intent.asset.value
        # trigger is the breakout level the MD set — treat it as the fill.
        entry = intent.trigger or _seed_price(intent.symbol, asset)
        direction = 1 if intent.side == Side.LONG else -1
        # `stop` arrives as a fraction (0.05 = 5%) below/above entry.
        stop = entry * (1 - direction * intent.stop)
        return Position(
            symbol=intent.symbol,
            asset=asset,
            side=intent.side,
            qty=intent.qty,
            entry=entry,
            stop=stop,
            last=entry,
            high=entry,
            low=entry,
            commission=round(random.uniform(0.6, 3.2), 2),
        )

    def tick(self) -> None:
        """Random-walk every open position."""
        for p in self.positions.values():
            p.last *= 1 + random.uniform(-0.0016, 0.0018)
            p.high = max(p.high, p.last)
            p.low = min(p.low, p.last)

    # ── read model ──────────────────────────────────────────────────────────
    @property
    def equity(self) -> float:
        return START_EQUITY + sum(p.pnl for p in self.positions.values())

    @property
    def bp_used_pct(self) -> float:
        eq = self.equity
        if eq <= 0:
            return 0.0
        return min(100.0, sum(p.notional for p in self.positions.values()) / eq * 100)

    def snapshot(self) -> list[SymbolSnapshot]:
        """The /api/snapshot payload. Account-level figures (equity, bp) are
        repeated on every row because buildMd() takes max() across them."""
        equity = self.equity
        bp = self.bp_used_pct
        out: list[SymbolSnapshot] = []
        for p in self.positions.values():
            spread = p.last * random.uniform(0.0002, 0.0009)
            bid = round(p.last - spread / 2, p.dp)
            ask = round(p.last + spread / 2, p.dp)
            out.append(
                SymbolSnapshot(
                    symbol=p.symbol,
                    spread_bps=round((ask - bid) / p.last * 10_000, 1) if p.last else 0,
                    state=SnapshotState(
                        entry_price=round(p.entry, p.dp),
                        stop_loss=round(p.stop, p.dp),
                        quantity=p.qty,
                        pnl=round(p.pnl),
                        total_commission=p.commission,
                        trades_today=p.trades_today,
                        state="IN_POSITION",
                        cycle_id=p.cycle,
                        wins=p.wins,
                        losses=p.losses,
                    ),
                    live=SnapshotLive(
                        last=round(p.last, p.dp),
                        bid=bid,
                        ask=ask,
                        high=round(p.high, p.dp),
                        low=round(p.low, p.dp),
                        vwap=round((p.high + p.low) / 2, p.dp),
                        volume=round(p._vol),
                        buy_pct=round(random.uniform(38, 62)),
                        equity=round(equity, 2),
                        position_notional=round(p.notional, 2),
                        bp_used_pct=round(bp, 2),
                    ),
                )
            )
        return out


engine = Engine()
