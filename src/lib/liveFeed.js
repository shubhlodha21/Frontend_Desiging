// Live feed adapter — turns the FastAPI backend (webapp/backend) into the exact
// shape MdScreen already consumes. The whole point of mdData.js's shape was to
// mirror /api/snapshot, so this is a thin map + a poll loop.
//
// Graceful degradation: if the backend isn't reachable (no dev server, or bots
// not running yet), we keep showing generateMdData() demo data. So the phone
// screen and the Figma capture never break — they just light up with real
// numbers the moment the backend is up.
import { useEffect, useRef, useState } from "react";
import { generateMdData } from "./mdData.js";

// Same-origin in dev (Vite proxies /api + /ws) and in prod (backend serves dist).
async function getJSON(path) {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// Snapshot carries no asset-class field; infer it the same way the engine names
// contracts: 6-letter = FX pair, IB* = index CFD, else equity / single-stock CFD.
function inferAsset(sym) {
  if (/^[A-Z]{6}$/.test(sym)) return "FX";
  if (sym.startsWith("IB")) return "CFD";
  return "EQUITY";
}

// One SymbolSnapshot → one positions-table row (the shape MobilePosCard/
// PositionDetail/Positions already read). Fields the snapshot doesn't carry
// (per-fill history, offset) are left empty/zero — v1 read model.
function mapPosition(s) {
  const st = s.state || {};
  const lv = s.live || {};
  const entry = st.entry_price || 0;
  const stop = st.stop_loss || 0;
  const slPct = entry > 0 && stop > 0 ? Math.abs(((entry - stop) / entry) * 100) : 0;
  return {
    symbol: s.symbol,
    asset: inferAsset(s.symbol),
    strategy: "LONG", // backend run_live.py is long-breakout only (short = separate deployment)
    qty: st.quantity || 0,
    entry: +entry.toFixed(4),
    last: lv.last || 0,
    bid: lv.bid || 0,
    ask: lv.ask || 0,
    spreadBps: +(s.spread_bps || 0).toFixed(1),
    high: lv.high || 0,
    low: lv.low || 0,
    vwap: lv.vwap || 0,
    volume: lv.volume || 0,
    buyPct: Math.round(lv.buy_pct || 50),
    stop: +stop.toFixed(4),
    slPct: +slPct.toFixed(2),
    offset: 0,
    pnl: Math.round(st.pnl || 0),
    realized: 0,
    series: [],
    fills: [],
    totalCommission: +(st.total_commission || 0).toFixed(2),
    avgCommission: 0,
    tradeCount: st.trades_today || 0,
    state: st.state || "MONITORING",
    cycle: st.cycle_id || 1,
  };
}

// snapshots[] + accumulating series ref → the full generateMdData()-shaped object.
function buildMd(snaps, series) {
  const positions = snaps.map(mapPosition);
  const dayPnl = Math.round(snaps.reduce((a, s) => a + (s.state?.pnl || 0), 0));
  const equity = Math.max(0, ...snaps.map((s) => s.live?.equity || 0)) || 1_000_000 + dayPnl;
  const exposure = Math.round(snaps.reduce((a, s) => a + (s.live?.position_notional || 0), 0));
  const bpUsedPct = Math.max(0, ...snaps.map((s) => s.live?.bp_used_pct || 0));
  const wins = snaps.reduce((a, s) => a + (s.state?.wins || 0), 0);
  const losses = snaps.reduce((a, s) => a + (s.state?.losses || 0), 0);
  const open = positions.filter((p) => p.qty).length;

  // History isn't in the point-in-time snapshot; accumulate it live.
  series.t += 1;
  series.pnl.push({ timestamp: series.t, total: dayPnl });
  const netPos = positions.reduce((a, p) => a + (p.qty ? (p.strategy === "LONG" ? 1 : -1) * p.qty : 0), 0);
  series.pos.push({ timestamp: series.t, pos: netPos });
  if (series.pnl.length > 240) { series.pnl.shift(); series.pos.shift(); }

  const account = {
    equity,
    dayPnl,
    dayPnlPct: equity > 0 ? (dayPnl / equity) * 100 : 0,
    exposure,
    bpUsedPct,
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    wins, losses,
    open,
    bots: positions.length,
  };
  return {
    account,
    positions,
    pnl_series: series.pnl.slice(),
    position_series: series.pos.slice(),
    alerts: [],
  };
}

// Hook: returns generateMdData()-shaped data + a `mode` flag
// ("demo" | "live" | "live-empty"). Poll every 1.5s; a /ws message triggers an
// immediate refresh so the eye sees fills land without waiting for the poll.
export function useMdData() {
  const [state, setState] = useState(() => ({ ...generateMdData(), mode: "demo" }));
  const series = useRef({ pnl: [], pos: [], t: 0 });

  useEffect(() => {
    let alive = true;
    let ws;
    async function pull() {
      try {
        const snaps = await getJSON("/api/snapshot");
        if (!alive) return;
        if (Array.isArray(snaps) && snaps.length) {
          setState({ ...buildMd(snaps, series.current), mode: "live" });
        } else {
          setState((s) => ({ ...s, mode: "live-empty" })); // backend up, no bots
        }
      } catch {
        /* backend unreachable → stay on whatever we have (demo) */
      }
    }
    pull();
    const iv = setInterval(pull, 1500);
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = () => pull();
    } catch { /* no ws → poll-only is fine */ }
    return () => { alive = false; clearInterval(iv); try { ws && ws.close(); } catch { /* noop */ } };
  }, []);

  return state;
}

// ── launch-approval queue (MD proposes → desk approves) ─────────────────────
// Maps the Strategy order ticket to a LaunchIntentRequest and posts it.
export async function submitLaunchIntent(order) {
  const trigger = Number(order.trigger) || 0;
  if (trigger <= 0) throw new Error("Set a trigger price before submitting");
  const stop = Math.min(0.99, Math.max(0.0001, Number(order.stop) || 0.01));
  const body = {
    symbol: String(order.symbol || "").toUpperCase(),
    side: order.strategyId === "short_breakout" ? "SHORT" : "LONG",
    asset: order.asset || "EQUITY",
    qty: Math.max(1, Math.round(Number(order.qty) || 1)),
    trigger,
    stop,
    offset: order.offset ? Number(order.offset) : null,
    paper: true,
  };
  const r = await fetch("/api/launch-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`intent → ${r.status}`);
  return r.json();
}

export async function fetchIntents() {
  return getJSON("/api/launch-intents");
}
