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
  const asset = inferAsset(s.symbol);
  const dp = asset === "FX" ? 5 : 2;   // FX needs sub-pip precision; equities/indices 2
  const entry = st.entry_price || 0;
  const stop = st.stop_loss || 0;
  const slPct = entry > 0 && stop > 0 ? Math.abs(((entry - stop) / entry) * 100) : 0;
  // Entry offset: a launch-time constant (--offset-entry-pct etc.). Percent kinds
  // are applied to the price → dollar value differs per entry (entry when in a
  // position, else the live price). Absolute kinds (sl_limit/fixed) show as-is.
  const offBase = entry > 0 ? entry : (lv.last || 0);
  const offRaw = s.offset || 0;
  const offDir = s.side === "SHORT" ? -1 : 1;  // limit sits below entry for shorts
  // Exact entry-limit price: entry ± entry×pct (percent kinds), or entry ± buffer.
  const offAbs = (s.offset_kind === "sl_limit" || s.offset_kind === "fixed")
    ? offBase + offDir * offRaw
    : offBase * (1 + offDir * offRaw);
  // percent form of the offset (for the clickable-header % toggle)
  const offPct = (s.offset_kind === "sl_limit" || s.offset_kind === "fixed")
    ? (offBase ? (offRaw / offBase) * 100 : 0)
    : offRaw * 100;
  return {
    symbol: s.symbol,
    clientId: s.client_id || 0,
    asset,
    strategy: s.side === "SHORT" ? "SHORT" : "LONG", // from the source deployment dir
    qty: st.quantity || 0,
    entry: +entry.toFixed(dp),
    trigger: (Number(st.trigger_price) || 0).toFixed(dp),  // string → keeps trailing zeros
    last: +(lv.last || 0).toFixed(dp),                     // round off float noise
    bid: lv.bid || 0,
    ask: lv.ask || 0,
    spreadBps: +(s.spread_bps || 0).toFixed(1),
    high: lv.high || 0,
    low: lv.low || 0,
    vwap: lv.vwap || 0,
    volume: lv.volume || 0,
    buyPct: Math.round(lv.buy_pct || 50),
    stop: (Number(stop) || 0).toFixed(dp),
    slPct: +slPct.toFixed(2),
    offset: offAbs.toFixed(dp),
    offsetPct: offPct.toFixed(2) + "%",
    pnl: Math.round(st.pnl || 0),
    realized: 0,
    series: [],
    fills: [],
    protective: s.protective || null,   // real resting exit order (auto-updates)
    totalCommission: +(st.total_commission || 0).toFixed(2),
    avgCommission: 0,
    tradeCount: st.trades_today || 0,
    state: st.state || "MONITORING",
    cycle: st.cycle_seq || 1,
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

// A blank/empty payload — used when the backend is up but has no bots, so the
// screen shows an honest empty state instead of stale demo numbers. One zero
// point keeps the charts (which read .at(-1)) from crashing.
function emptyMd() {
  return {
    account: { equity: 0, dayPnl: 0, dayPnlPct: 0, exposure: 0, bpUsedPct: 0, winRate: 0, wins: 0, losses: 0, open: 0, bots: 0 },
    positions: [],
    pnl_series: [{ timestamp: 0, total: 0 }],
    position_series: [{ timestamp: 0, pos: 0 }],
    alerts: [],
  };
}

// Hook: returns generateMdData()-shaped data + a `mode` flag.
//   live       — real bots present
//   live-empty — backend reachable but no bots → BLANK (not demo)
//   demo       — backend NEVER reachable (standalone / Figma preview) → demo data
// Demo is only a true-offline fallback; once we've talked to the backend we
// never show fake numbers again.
export function useMdData() {
  const [state, setState] = useState(() => ({ ...emptyMd(), mode: "loading" }));
  const series = useRef({ pnl: [], pos: [], t: 0 });
  const connected = useRef(false);

  useEffect(() => {
    let alive = true;
    let ws;
    async function pull() {
      try {
        const snaps = await getJSON("/api/snapshot");
        if (!alive) return;
        connected.current = true;
        if (Array.isArray(snaps) && snaps.length) {
          setState({ ...buildMd(snaps, series.current), mode: "live" });
        } else {
          setState({ ...emptyMd(), mode: "live-empty" }); // backend up, no bots → blank
        }
      } catch {
        // Backend unreachable. Only fall back to demo if we NEVER connected
        // (standalone/Figma). If we had connected, keep the last live data.
        if (alive && !connected.current) {
          setState((s) => (s.mode === "demo" ? s : { ...generateMdData(), mode: "demo" }));
        }
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
  // --stop is a FRACTION of price. Convert the ticket value by its unit:
  //   "%"  → value/100                       (0.5% → 0.005)
  //   abs  → |trigger − stopPrice| / trigger  (an absolute stop price)
  const stopRaw = Number(order.stop) || 0;
  const stopFrac = order.stopUnit === "PCT"
    ? stopRaw / 100
    : (trigger > 0 ? Math.abs(trigger - stopRaw) / trigger : stopRaw);
  const stop = Math.min(0.99, Math.max(0.0001, stopFrac || 0.01));
  const body = {
    symbol: String(order.symbol || "").toUpperCase(),
    side: order.strategyId === "short_breakout" ? "SHORT" : "LONG",
    asset: order.asset || "EQUITY",
    qty: Math.max(1, Math.round(Number(order.qty) || 1)),
    trigger,
    stop,
    // --offset-entry-pct is a FRACTION of price. Convert the ticket value by its
    // unit: "%" → value/100 (0.05% → 0.0005); absolute → value/trigger.
    offset: (() => {
      const n = Number(order.offset);
      if (!n || n <= 0) return null;
      return order.offsetUnit === "PCT" ? n / 100 : n / trigger;
    })(),
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

export async function fetchIntents({ pendingOnly = false } = {}) {
  return getJSON(`/api/launch-intents${pendingOnly ? "?pending_only=true" : ""}`);
}

// ── desk decisions (admin screen) ───────────────────────────────────────────
// Both are one-shot server-side: deciding an already-decided intent returns 409
// rather than re-opening a position the engine already holds. Callers surface
// that as "someone else got there first" and refetch.
async function decide(id, action, body) {
  const r = await fetch(`/api/launch-intents/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    const err = new Error(`${action} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export const approveIntent = (id) => decide(id, "approve");
export const rejectIntent = (id, reason) => decide(id, "reject", { reason: reason || null });

// Lazy per-symbol execution history for the Trades Sheet — fetched only when a
// detail popup opens, so it stays off the snapshot poll. Empty on failure (demo
// / no backend) so the popup just shows no rows instead of erroring.
export async function fetchFills(symbol) {
  try {
    return await getJSON(`/api/fills/${encodeURIComponent(symbol)}`);
  } catch {
    return [];
  }
}

// Cancel a bot: backend kills the process + wipes its 4 state files.
export async function cancelPosition(symbol, clientId) {
  const q = clientId != null ? `?client_id=${clientId}` : "";
  const r = await fetch(`/api/cancel/${encodeURIComponent(symbol)}${q}`, { method: "POST" });
  if (!r.ok) throw new Error(`cancel → ${r.status}`);
  return r.json();
}

// Recent price series (from the feed audit) for the detail-popup chart.
export async function fetchHistory(symbol, minutes = 30) {
  try {
    return await getJSON(`/api/history/${encodeURIComponent(symbol)}?minutes=${minutes}`);
  } catch {
    return [];
  }
}
