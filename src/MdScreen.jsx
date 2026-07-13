// MD screen — the managing director's desk view. Executive oversight of the
// GT breakout desk (long + short strategies) with order placement front-and-
// centre. Built entirely on HER design system (see prosperity_frontend_extract/
// HER_DESIGN_SYSTEM.md): tiny uppercase letter-spaced labels, hairline pill
// controls, zinc palette + JetBrains-Mono data, accents ONLY for status.
import { useEffect, useMemo, useRef, useState } from "react";
import { generateMdData } from "./lib/mdData.js";
import { useMdData, submitLaunchIntent, fetchIntents } from "./lib/liveFeed.js";
import { PnlChart } from "./components/Charts.jsx";
import { Card, Money, Chip, Label } from "./components/ui.jsx";
import { ComposedChart, Area, Scatter, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer } from "recharts";
import { sileo, Toaster } from "sileo";

// Sileo physics-toast notifications — pop from top-centre. Safe wrapper:
// info/warning fall back to success if a variant isn't present.
function notify(kind, title) {
  const fn = typeof sileo?.[kind] === "function" ? sileo[kind] : sileo?.success;
  try { fn?.({ title }); } catch { try { sileo?.success?.({ title }); } catch { /* noop */ } }
}

const OPERATOR = { desk: "Gautam Group", name: "Managing Director", account: "Paper · DU" };

// ── accent helpers: her -50/-100 bg + -700 text recipe (colour = status only) ──
const STATE_TONE = {
  IN_POSITION: "border-emerald-200 bg-emerald-50 text-emerald-700",
  WAITING_REENTRY: "border-amber-300 bg-amber-100 text-amber-700",
  ORDER_ENTRY: "border-sky-200 bg-sky-50 text-sky-700",
  MONITORING: "border-zinc-200 bg-zinc-50 text-zinc-500",
};
const SEV_TONE = {
  HIGH: "border-red-100 bg-red-50 text-red-700",
  MEDIUM: "border-amber-300 bg-amber-100 text-amber-700",
  LOW: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

// Deployable strategies — data-driven so adding one is a single entry.
const STRATEGIES = [
  { id: "long_breakout", name: "Long Breakout", side: "LONG", desc: "BUY stop-limit on breakout · protective SELL stop" },
  { id: "short_breakout", name: "Short Breakout", side: "SHORT", desc: "SELL stop-limit on breakdown · protective BUY-cover stop" },
];

function fmtUsd(n) {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Full timestamp in Dubai / Gulf Standard Time (the desk's local time).
const _DUBAI = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const fmtDubai = (ms) => _DUBAI.format(new Date(ms)).replace(",", "");

// ── minimal corner line-icons (Prosperity's stat-card accent) ──────────────
const ICONS = {
  equity: <path d="M2 11l3.5-3.5 3 3L14 4.5M14 4.5h-3.2M14 4.5v3.2" />,      // up-trend + arrow
  pnl: <path d="M2 11l3.5-3.5 3 3L14 4.5M14 4.5h-3.2M14 4.5v3.2" />,          // up-trend + arrow
  exposure: <path d="M8 2.2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 10.8l6 3 6-3" />, // layers
  bp: <><circle cx="8" cy="8" r="6" /><path d="M8 8V2.4M8 8l4.2 2.4" /></>,   // gauge/clock
  win: <><circle cx="8" cy="8" r="6" /><path d="M5.3 8.2l1.8 1.8 3.6-3.9" /></>, // check-in-ring
  dd: <path d="M2 5l3.5 3.5 3-3L14 11.5M14 11.5h-3.2M14 11.5v-3.2" />,       // down-trend + arrow
};
function Ico({ d }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

// ── live NYSE session clock (a small personalisation touch) ────────────────
function useSession() {
  const [s, setS] = useState(sess);
  useEffect(() => {
    const t = setInterval(() => setS(sess()), 1000);
    return () => clearInterval(t);
  }, []);
  return s;
}
function sess() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  const wd = g("weekday"), hh = +g("hour"), mm = g("minute");
  const mins = hh * 60 + +mm, weekend = wd === "Sat" || wd === "Sun";
  const clock = `${String(hh).padStart(2, "0")}:${mm} ET`;
  if (weekend) return { label: "Closed", tone: "bg-zinc-300", clock };
  if (mins >= 570 && mins < 960) return { label: "Market Open", tone: "bg-emerald-500", clock };
  if (mins >= 240 && mins < 570) return { label: "Pre-Market", tone: "bg-amber-400", clock };
  if (mins >= 960 && mins < 1200) return { label: "After-Hours", tone: "bg-amber-400", clock };
  return { label: "Closed", tone: "bg-zinc-300", clock };
}

export default function MdScreen() {
  const [data, setData] = useState(() => generateMdData());
  const { account, pnl_series, position_series, positions, alerts } = data;
  const marker = pnl_series.at(-1).timestamp;
  const ticketRef = useRef(null);

  // ── cross-panel linkage: click a position → it flows into the ticket ──
  const [order, setOrder] = useState({
    mode: "STRATEGY", strategyId: "long_breakout", asset: "EQUITY", symbol: "NVDA",
    qty: "100", value: "10000", sizeMode: "QTY", trigger: "0",
    stop: "0.05", stopUnit: "PCT", offset: "0.05", offsetUnit: "ABS",
    orderType: "MKT", limitPrice: "0", stopPrice: "0", tif: "DAY",
  });
  const [selected, setSelected] = useState(null);
  function pickPosition(p) {
    setOrder((o) => ({
      ...o, mode: "STRATEGY",
      strategyId: p.strategy === "SHORT" ? "short_breakout" : "long_breakout",
      asset: p.asset, symbol: p.symbol, qty: String(p.qty || 100), trigger: String(p.last), stop: "0.05",
    }));
    setSelected(p.symbol);
    ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // clicking a position/live-card opens a symbol detail popup over the screen
  const [detail, setDetail] = useState(null);
  function actOnPosition(p, kind) {
    notify(kind === "Modify stop" ? "info" : "warning", `${kind} · ${p.symbol}`);
  }

  const [assetFilter, setAssetFilter] = useState("ALL");
  const shown = useMemo(
    () => (assetFilter === "ALL" ? positions : positions.filter((p) => p.asset === assetFilter)),
    [positions, assetFilter],
  );

  const peak = useMemo(() => Math.max(...pnl_series.map((p) => p.total)), [pnl_series]);
  const trough = useMemo(() => Math.min(...pnl_series.map((p) => p.total), 0), [pnl_series]);

  // desk-wide combined feeds for the main page
  const allFills = useMemo(
    () => positions
      .flatMap((p) => p.fills.map((f) => ({ ...f, symbol: p.symbol, asset: p.asset, strategy: p.strategy })))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 16),
    [positions],
  );
  const working = useMemo(
    () => positions.map((p) => {
      const long = p.strategy === "LONG";
      if (p.qty) return { symbol: p.symbol, asset: p.asset, side: long ? "SELL" : "BUY", type: "STP", note: "protective", qty: p.qty, price: p.stop, status: "Working" };
      if (p.state === "WAITING_REENTRY") return { symbol: p.symbol, asset: p.asset, side: long ? "BUY" : "SELL", type: "LMT", note: "re-entry", qty: 100, price: p.entry, status: "Working" };
      return { symbol: p.symbol, asset: p.asset, side: long ? "BUY" : "SELL", type: "STP LMT", note: "entry", qty: 100, price: p.trigger || p.last, status: "PreSubmitted" };
    }),
    [positions],
  );

  const kpis = [
    { label: "Equity", icon: ICONS.equity, value: fmtUsd(account.equity), sub: `${account.bots} strategies live` },
    { label: "Day P&L", icon: ICONS.pnl, money: account.dayPnl, sub: `${account.dayPnlPct >= 0 ? "+" : ""}${account.dayPnlPct.toFixed(2)}%` },
    { label: "Open Exposure", icon: ICONS.exposure, value: fmtUsd(account.exposure), sub: `${account.open} positions` },
    { label: "BP Utilization", icon: ICONS.bp, value: `${account.bpUsedPct.toFixed(1)}%`, sub: "of buying power" },
    { label: "Win Rate", icon: ICONS.win, value: `${account.winRate}%`, sub: `${account.wins}W / ${account.losses}L` },
    { label: "Max Drawdown", icon: ICONS.dd, value: fmtUsd(trough), sub: `peak ${fmtUsd(peak)}` },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-100 text-zinc-900">
      <Sidebar
        live={positions.filter((p) => p.qty)}
        selected={detail?.symbol}
        onPick={setDetail}
        onNew={() => ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onRegen={() => setData(generateMdData())}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="w-full flex-1 space-y-5 px-8 py-6">
          {/* KPI ROW */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-zinc-300">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{k.label}</span>
                  <Ico d={k.icon} />
                </div>
                <div className="mt-1.5 font-mono text-[19px] font-medium tabular-nums leading-none">
                  {k.money !== undefined ? <Money value={k.money} /> : <span className="text-zinc-900">{k.value}</span>}
                </div>
                <div className="mt-1.5 font-mono text-[10px] tabular-nums text-zinc-400">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* MAIN GRID: curve + positions (left) · order ticket + alerts (right) */}
          <div className="grid grid-cols-1 gap-5 xl:[grid-template-columns:minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <Positions rows={shown} asset={assetFilter} setAsset={setAssetFilter} onPick={setDetail} selected={detail?.symbol} onAction={actOnPosition} />

              <Card
                title="Cumulative P&L — Today"
                subtitle="Intraday realised + unrealised across all strategies"
                right={<span className="font-mono text-[11px] tabular-nums"><Money value={account.dayPnl} /></span>}
              >
                <PnlChart pnlSeries={pnl_series} marker={marker} />
              </Card>

              <Card title="Net Position — Today" subtitle="Desk-wide net units across strategies">
                <PositionChart series={position_series} />
              </Card>

              <RecentFills fills={allFills} />
              <WorkingOrders rows={working} />
            </div>

            <div className="space-y-5" ref={ticketRef}>
              <OrderTicket order={order} setOrder={setOrder} fromSymbol={selected} onClear={() => setSelected(null)} />
              <Alerts alerts={alerts} />
            </div>
          </div>

          <SystemLogs />
        </main>
      </div>

      {detail && (
        <PositionDetail p={detail} onClose={() => setDetail(null)} onOrder={(pp) => { pickPosition(pp); setDetail(null); }} />
      )}
      <Toaster position="top-center" theme="light" />
    </div>
  );
}

// ── symbol detail popup (drill-in over the current screen) ──────────────────
function DCell({ label, children, tone }) {
  const c = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <div className="text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className={`mt-1 font-mono text-[14px] tabular-nums ${c}`}>{children}</div>
    </div>
  );
}
// ── the drill-in price chart: price path + entry/stop lines + fill markers ──
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const px = payload.find((x) => x.dataKey === "price");
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white shadow-xl">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">t{label}</div>
      {px && <div className="font-mono text-[12px] tabular-nums">{px.value}</div>}
    </div>
  );
}
function SymbolChart({ p }) {
  const data = useMemo(() => {
    const rows = p.series.map((s) => ({ ...s, buy: null, sell: null }));
    for (const f of p.fills) {
      const r = rows[Math.min(rows.length - 1, f.x)];
      if (f.side === "BUY") r.buy = f.price; else r.sell = f.price;
    }
    return rows;
  }, [p]);
  const axis = { tick: { fontSize: 10, fill: "#a1a1aa", fontFamily: "JetBrains Mono" }, tickLine: false };
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pxf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#71717a" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" {...axis} axisLine={{ stroke: "#e4e4e7" }} />
          <YAxis domain={["auto", "auto"]} orientation="right" width={56} {...axis} axisLine={false} />
          <Tooltip content={<ChartTip />} />
          <ReferenceLine y={p.entry} stroke="#a1a1aa" strokeDasharray="4 3" strokeWidth={1} />
          <ReferenceLine y={p.stop} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} />
          <Area type="monotone" dataKey="price" stroke="#3f3f46" strokeWidth={1.4} fill="url(#pxf)" isAnimationActive={false} />
          <Scatter dataKey="buy" fill="#2563eb" isAnimationActive={false} />
          <Scatter dataKey="sell" fill="#f59e0b" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionDetail({ p, onClose, onOrder }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const chg = ((p.last - p.entry) / p.entry) * 100;
  const value = p.qty ? p.last * p.qty : 0;
  const buy = Math.max(0, Math.min(100, p.buyPct));
  const pill = "rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] tabular-nums";
  const tc = "grid grid-cols-[1.6fr_0.5fr_0.8fr_0.5fr_0.7fr_0.9fr_0.8fr_0.85fr_0.95fr_0.9fr_0.9fr] items-center gap-x-4 px-4";

  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm sm:p-8">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${p.strategy === "LONG" ? "bg-emerald-500" : "bg-red-500"}`} />
                <h3 className="text-lg font-semibold text-zinc-900">{p.symbol}</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">{p.asset} · {p.strategy}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATE_TONE[p.state]}`}>{p.state.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-medium tabular-nums text-zinc-900">{p.last}</span>
                <span className={`font-mono text-[12px] tabular-nums ${chg >= 0 ? "text-emerald-600" : "text-red-600"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
              </div>
            </div>
            {/* live bid/ask/spread */}
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <span className={`${pill} text-emerald-600`}>BID {p.bid}</span>
              <span className={`${pill} text-red-600`}>ASK {p.ask}</span>
              <span className={`${pill} text-zinc-600`}>{p.spreadBps} bp</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onOrder(p)} className="rounded-full bg-zinc-900 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white shadow-sm shadow-zinc-200 transition-all hover:bg-zinc-800">New Order</button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-zinc-200 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-700">✕</button>
          </div>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* chart */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">Price & Fills</span>
                  <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-400">
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#2563eb]" />Buy</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />Sell</span>
                    <span className="flex items-center gap-1"><span className="h-px w-3 bg-zinc-400" />Entry</span>
                    <span className="flex items-center gap-1"><span className="h-px w-3 bg-red-400" />Stop</span>
                  </div>
                </div>
                <div className="px-2 py-2"><SymbolChart p={p} /></div>
              </div>
            </div>
            {/* right stats */}
            <div className="space-y-4">
              <div>
                <Label>Snapshot</Label>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  <DCell label="VWAP">{p.vwap}</DCell>
                  <DCell label="Volume">{(p.volume / 1e6).toFixed(2)}M</DCell>
                  <DCell label="Day High">{p.high}</DCell>
                  <DCell label="Day Low">{p.low}</DCell>
                </div>
              </div>
              <div>
                <Label>Execution</Label>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  <DCell label="Trades">{p.tradeCount}</DCell>
                  <DCell label="Cycle">#{p.cycle}</DCell>
                  <DCell label="Avg Comm">${p.avgCommission}</DCell>
                  <DCell label="Total Comm">${p.totalCommission}</DCell>
                </div>
              </div>
            </div>
          </div>

          {/* position internals */}
          <div>
            <Label>Position</Label>
            <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
              <DCell label="Qty">{p.qty ? p.qty.toLocaleString() : "flat"}</DCell>
              <DCell label="Entry">{p.entry}</DCell>
              <DCell label="Stop" tone="neg">{p.stop}</DCell>
              <DCell label="Offset">{p.offset}</DCell>
              <DCell label="SL %">{p.slPct}%</DCell>
              <DCell label="Value">{p.qty ? fmtUsd(value) : "—"}</DCell>
              <DCell label="Unreal" tone={p.pnl >= 0 ? "pos" : "neg"}>{p.pnl ? (p.pnl >= 0 ? "+" : "") + p.pnl.toLocaleString() : "—"}</DCell>
              <DCell label="Realized" tone={p.realized >= 0 ? "pos" : "neg"}>{(p.realized >= 0 ? "+" : "") + p.realized.toLocaleString()}</DCell>
            </div>
          </div>

          {/* market pressure */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Market Pressure</Label>
              <span className="font-mono text-[10px] tabular-nums text-zinc-400">{buy}% buy · {100 - buy}% sell</span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="bg-emerald-500" style={{ width: `${buy}%` }} />
              <div className="bg-red-400" style={{ width: `${100 - buy}%` }} />
            </div>
          </div>

          {/* trades sheet — full execution audit */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Trades Sheet</Label>
              <span className="font-mono text-[10px] tabular-nums text-zinc-400">{p.fills.length} fills · avg comm ${p.avgCommission} · times in Dubai (GST)</span>
            </div>
            <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
              <div className={`${tc} border-b border-zinc-100 bg-zinc-50 py-2.5 text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-400`}>
                <span>Time · GST</span>
                <span>Side</span>
                <span>Type</span>
                <span>TIF</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Fill</span>
                <span className="text-right">Slippage</span>
                <span className="text-right">Comm</span>
                <span>Venue</span>
                <span className="text-right">Order #</span>
                <span className="text-right">P&L</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {p.fills.map((f, i) => (
                  <div key={i} className={`${tc} py-2.5 font-mono text-[12px] tabular-nums transition-colors hover:bg-zinc-50`}>
                    <span className="text-zinc-500">{fmtDubai(f.ts)}</span>
                    <span className={f.side === "BUY" ? "font-medium text-emerald-600" : "font-medium text-red-600"}>{f.side}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">{f.type}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-400">{f.tif}</span>
                    <span className="text-right text-zinc-600">{f.qty.toLocaleString()}</span>
                    <span className="text-right text-zinc-800">{f.price}</span>
                    <span className={`text-right ${f.slippageBp > 0 ? "text-red-600" : "text-emerald-600"}`}>{f.slippageBp > 0 ? "+" : ""}{f.slippageBp}bp</span>
                    <span className="text-right text-zinc-500">${f.commission.toFixed(2)}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-400">{f.exchange}</span>
                    <span className="text-right text-zinc-400">#{f.orderId}</span>
                    <span className="text-right">{f.pnl ? <Money value={f.pnl} /> : <span className="text-zinc-300">—</span>}</span>
                  </div>
                ))}
              </div>
              <div className={`${tc} border-t border-zinc-100 bg-zinc-50/60 py-2.5 font-mono text-[11px] tabular-nums text-zinc-500`}>
                <span className="uppercase tracking-[0.14em] text-zinc-400">Total</span>
                <span /><span /><span /><span /><span /><span />
                <span className="text-right text-zinc-700">${p.totalCommission}</span>
                <span /><span />
                <span className="text-right"><Money value={p.pnl + p.realized} /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ onNew, onRegen, live = [], onPick, selected }) {
  const nav = ["Overview", "Positions", "Activity", "Statements"];
  return (
    <aside className="sticky top-0 flex h-screen w-[300px] shrink-0 flex-col border-r border-zinc-200 bg-white px-5 py-5">
      <div className="flex items-center gap-2.5 px-1">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900 font-mono text-[12px] font-bold text-white">GT</div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">GT Capital</div>
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400">Desk · User</div>
        </div>
      </div>

      <button
        onClick={onNew}
        className="group mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 py-4 text-xs font-bold uppercase tracking-widest text-white shadow-xl shadow-zinc-200 transition-all hover:bg-zinc-800"
      >
        + New Order
      </button>

      {/* access gate — the MD view is oversight; order placement needs admin approval */}
      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-100 px-3.5 py-3">
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-700">Access</div>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-amber-700" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="7" width="9" height="6" rx="1.2" />
            <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
          </svg>
        </div>
        <div className="mt-1 text-[13px] font-semibold text-zinc-800">Admin approval required</div>
        <div className="font-mono text-[10px] text-amber-700/80">Order placement is gated · read-only</div>
      </div>

      <div className="mt-6 px-1"><Label>Views</Label></div>
      <nav className="mt-2 space-y-0.5">
        {nav.map((n, i) => (
          <button key={n} className={`flex w-full items-center rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${i === 0 ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}`}>
            {n}
          </button>
        ))}
      </nav>

      {/* live positions — minimal stacked cards (ticker · side · qty · LTP) */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-1">
          <Label>Live</Label>
          <span className="font-mono text-[9px] font-bold text-zinc-400">{live.length}</span>
        </div>
        <div className="mt-2 space-y-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {live.map((p) => (
            <button
              key={p.symbol}
              onClick={() => onPick?.(p)}
              title="Load into order ticket"
              className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${selected === p.symbol ? "bg-zinc-800 ring-1 ring-inset ring-white/25" : "bg-zinc-900 hover:bg-zinc-800"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${p.strategy === "LONG" ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="text-[12px] font-semibold text-white">{p.symbol}</span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-white/90">{p.last}</span>
              </div>
              <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                <span>{p.asset} · {p.strategy}</span>
                <span className="tabular-nums">{p.qty.toLocaleString()}</span>
              </div>
            </button>
          ))}
          {live.length === 0 && <div className="px-1 py-2 text-[11px] text-zinc-400">No open positions.</div>}
        </div>
      </div>

      <div className="mt-4 shrink-0 space-y-2">
        <button onClick={onRegen} className="w-full rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900">
          Regenerate demo
        </button>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[10px] text-zinc-500">
          <div className="flex items-center justify-between"><span>TWS 127.0.0.1:7497</span><span className="h-2 w-2 rounded-full bg-emerald-500" /></div>
          <div className="mt-1 text-zinc-400">paper · demo data · v0.1</div>
        </div>
      </div>
    </aside>
  );
}

// ── top bar ──────────────────────────────────────────────────────────────
function TopBar() {
  const s = useSession();
  return (
    <header className="sticky top-0 z-10 flex h-[64px] items-center justify-between border-b border-zinc-200 bg-zinc-100/80 px-8 backdrop-blur">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-zinc-900">Trading Desk</h1>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Live oversight · paper account</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            {s.label === "Market Open" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${s.tone} opacity-60`} />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${s.tone}`} />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">{s.label}</span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">{s.clock}</span>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-900 font-mono text-[11px] font-semibold text-white">MD</div>
      </div>
    </header>
  );
}

// ── positions table ────────────────────────────────────────────────────────
function RowAct({ tone, children, onClick }) {
  const map = {
    red: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    amber: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    zinc: "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100",
    dark: "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800",
  };
  return <button onClick={onClick} className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${map[tone]}`}>{children}</button>;
}

function Positions({ rows, asset, setAsset, onPick, selected, onAction }) {
  const cols = "grid grid-cols-[1.3fr_0.95fr_0.6fr_0.85fr_0.85fr_0.7fr_0.55fr_1fr_0.85fr] items-center gap-x-3";
  return (
    <Card
      title="Positions & Strategies"
      right={
        <div className="inline-flex gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-1">
          {["ALL", "EQUITY", "FX", "CFD"].map((a) => (
            <Chip key={a} active={a === asset} onClick={() => setAsset(a)}>{a}</Chip>
          ))}
        </div>
      }
    >
      <div className={`${cols} mb-2 border-b border-zinc-100 pb-2 text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-400`}>
        <span>Symbol</span><span>State</span><span className="text-right">Qty</span><span className="text-right">Entry</span><span className="text-right">Last</span><span className="text-right">Offset</span><span className="text-right">SL %</span><span className="text-right">Value</span><span className="text-right">P&L</span>
      </div>
      <div className="space-y-px">
        {rows.map((p) => (
          <div
            key={p.symbol}
            onClick={() => onPick?.(p)}
            title="View details"
            className={`${cols} group relative cursor-pointer rounded-lg px-1 py-2 transition-colors ${selected === p.symbol ? "bg-zinc-50 ring-1 ring-inset ring-zinc-900/10" : "hover:bg-zinc-50"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.strategy === "LONG" ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="text-[13px] font-medium text-zinc-900">{p.symbol}</span>
              <span className="font-mono text-[9px] uppercase tracking-wide text-zinc-400">{p.asset} · {p.strategy}</span>
            </div>
            <div><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATE_TONE[p.state]}`}>{p.state.replace(/_/g, " ")}</span></div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-500">{p.qty ? p.qty.toLocaleString() : <span className="text-zinc-300">flat</span>}</div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-500">{p.entry}</div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-800">{p.last}</div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-500">{p.offset}</div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-500">{p.slPct}%</div>
            <div className="text-right font-mono text-[12px] tabular-nums text-zinc-800">{p.qty ? fmtUsd(p.last * p.qty) : <span className="text-zinc-300">—</span>}</div>
            <div className="text-right font-mono text-[12px] tabular-nums">{p.pnl ? <Money value={p.pnl} /> : <span className="text-zinc-300">—</span>}</div>

            {/* hover actions */}
            <div onClick={(e) => e.stopPropagation()} className="absolute inset-y-1 right-1 flex items-center gap-1 rounded-lg bg-gradient-to-l from-zinc-50 via-zinc-50 to-transparent pl-10 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
              {p.qty ? <RowAct tone="red" onClick={() => onAction?.(p, "Square off")}>Square&nbsp;off</RowAct> : null}
              <RowAct tone="amber" onClick={() => onAction?.(p, "Cancel orders")}>Cancel</RowAct>
              <RowAct tone="zinc" onClick={() => onAction?.(p, "Modify stop")}>Modify</RowAct>
              <RowAct tone="dark" onClick={() => onPick?.(p)}>Details</RowAct>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="py-8 text-center font-mono text-[11px] text-zinc-400">No {asset.toLowerCase()} positions.</div>}
      </div>
    </Card>
  );
}

// ── net-position step chart (the POSITION plot) ─────────────────────────────
function PositionChart({ series }) {
  const axis = { tick: { fontSize: 10, fill: "#a1a1aa", fontFamily: "JetBrains Mono" }, tickLine: false };
  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="posf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <XAxis dataKey="timestamp" {...axis} axisLine={{ stroke: "#e4e4e7" }} />
          <YAxis orientation="right" width={46} {...axis} axisLine={false} />
          <ReferenceLine y={0} stroke="#d4d4d8" />
          <Tooltip content={<ChartTip />} />
          <Area type="stepAfter" dataKey="pos" name="Net position" stroke="#4f46e5" strokeWidth={1.4} fill="url(#posf)" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── desk-wide recent fills (combined across all strategies) ─────────────────
function RecentFills({ fills }) {
  const tc = "grid grid-cols-[1.5fr_0.9fr_0.55fr_0.8fr_0.7fr_0.9fr_0.85fr_0.9fr] items-center gap-x-3";
  return (
    <Card title="Recent Fills" right={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">Desk-wide · {fills.length} · GST</span>}>
      <div className={`${tc} mb-2 border-b border-zinc-100 pb-2 text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-400`}>
        <span>Time · GST</span><span>Symbol</span><span>Side</span><span>Type</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Comm</span><span className="text-right">P&L</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {fills.map((f, i) => (
          <div key={i} className={`${tc} py-2 font-mono text-[12px] tabular-nums transition-colors hover:bg-zinc-50`}>
            <span className="text-zinc-500">{fmtDubai(f.ts)}</span>
            <span><span className="font-sans text-[12px] font-medium text-zinc-900">{f.symbol}</span> <span className="text-[9px] uppercase text-zinc-400">{f.asset}</span></span>
            <span className={f.side === "BUY" ? "font-medium text-emerald-600" : "font-medium text-red-600"}>{f.side}</span>
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">{f.type}</span>
            <span className="text-right text-zinc-600">{f.qty.toLocaleString()}</span>
            <span className="text-right text-zinc-800">{f.price}</span>
            <span className="text-right text-zinc-500">${f.commission.toFixed(2)}</span>
            <span className="text-right">{f.pnl ? <Money value={f.pnl} /> : <span className="text-zinc-300">—</span>}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── desk-wide working orders (resting bracket legs) ─────────────────────────
function WorkingOrders({ rows }) {
  const tc = "grid grid-cols-[1.3fr_0.6fr_1.2fr_0.7fr_0.9fr_0.9fr] items-center gap-x-3";
  return (
    <Card title="Working Orders" right={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">{rows.length} resting at broker</span>}>
      <div className={`${tc} mb-2 border-b border-zinc-100 pb-2 text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-400`}>
        <span>Symbol</span><span>Side</span><span>Type</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Status</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((o, i) => (
          <div key={i} className={`${tc} py-2 font-mono text-[12px] tabular-nums transition-colors hover:bg-zinc-50`}>
            <span><span className="font-sans text-[12px] font-medium text-zinc-900">{o.symbol}</span> <span className="text-[9px] uppercase text-zinc-400">{o.asset}</span></span>
            <span className={o.side === "BUY" ? "font-medium text-emerald-600" : "font-medium text-red-600"}>{o.side}</span>
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">{o.type} <span className="text-zinc-300">· {o.note}</span></span>
            <span className="text-right text-zinc-600">{o.qty.toLocaleString()}</span>
            <span className="text-right text-zinc-800">{o.price}</span>
            <span className="flex justify-end">
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${o.status === "Working" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-100 text-amber-700"}`}>{o.status}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── system logs (dark terminal panel: sandbox · algorithm · trader data) ─────
const LOGS = {
  sandbox: [
    { t: "15:42:01", cls: "text-zinc-300", msg: "[BROKER] bracket placed NVDA parent#3021 stp-lmt 391.20/391.15 child#3022 stp 389.65" },
    { t: "15:42:01", cls: "text-emerald-400", msg: "[FILL] NVDA BUY 100 @ 391.17 comm $1.10 slippage +0.3bp" },
    { t: "15:42:03", cls: "text-zinc-300", msg: "[STATE] NVDA MONITORING → IN_POSITION cycle=3" },
    { t: "15:44:12", cls: "text-amber-400", msg: "[GUARD] AAPL trigger mismatch on saved state — refused re-arm, kept 312.75" },
    { t: "15:45:22", cls: "text-zinc-300", msg: "[RECONCILE] 20/20 engines · ledger merged · 0 phantom" },
    { t: "15:46:40", cls: "text-emerald-400", msg: "[FILL] IBUS500 SELL 1 @ 7551.44 (short entry) comm $0.90" },
    { t: "15:48:09", cls: "text-red-400", msg: "[GUARD] AMD phantom BUY-cover rejected — engine FLAT, orphan child ignored" },
    { t: "15:49:55", cls: "text-zinc-300", msg: "[BROKER] child stop trailed NVDA 389.65 → 390.10" },
  ],
  algo: [
    { t: "15:42:00", cls: "text-zinc-300", msg: "long_breakout(NVDA): breakout confirmed above 391.10, arming stop-limit" },
    { t: "15:43:30", cls: "text-zinc-300", msg: "short_breakout(MSFT): breakdown below 385.30, protective BUY-cover set" },
    { t: "15:45:00", cls: "text-zinc-400", msg: "long_breakout(META): monitoring — 0.4% below trigger, no signal" },
    { t: "15:46:38", cls: "text-zinc-300", msg: "short_breakout(IBUS500): breakdown fired, trough tracking engaged" },
    { t: "15:47:10", cls: "text-amber-400", msg: "risk: BP utilisation 37.4% — within 90% cap, no throttle" },
    { t: "15:48:44", cls: "text-zinc-300", msg: "long_breakout(GOOGL): stopped out, WAITING_REENTRY armed at 364.20" },
    { t: "15:50:02", cls: "text-zinc-400", msg: "session: RTH open · 15 strategies active · 8 in position" },
  ],
  trader: [
    { t: "15:50:10", cls: "text-zinc-400", msg: '{ "session": "GT-DESK-0708", "account": "DU-paper", "strategies": 15 }' },
    { t: "15:50:10", cls: "text-zinc-300", msg: '{ "NVDA":  { "pos": 100, "entry": 391.17, "stop": 390.10, "cycle": 3 } }' },
    { t: "15:50:10", cls: "text-zinc-300", msg: '{ "MSFT":  { "pos": -100, "entry": 385.27, "stop": 386.90, "cycle": 2 } }' },
    { t: "15:50:10", cls: "text-zinc-300", msg: '{ "IBUS500": { "pos": -1, "entry": 7551.44, "stop": 7580.0, "cycle": 1 } }' },
    { t: "15:50:10", cls: "text-zinc-400", msg: '{ "ledger": { "fills_today": 47, "comm_today": 68.40, "net_pnl": 4591 } }' },
    { t: "15:50:10", cls: "text-zinc-400", msg: '{ "reconcile": { "engine": "ok", "broker": "ok", "market": "ok" } }' },
  ],
};
function SystemLogs() {
  const [tab, setTab] = useState("sandbox");
  const tabs = [
    { id: "sandbox", label: "Sandbox Logs", icon: ">_" },
    { id: "algo", label: "Algorithm Logs", icon: "▦" },
    { id: "trader", label: "Trader Data", icon: "</>" },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-sm">
      <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/40 px-3 py-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${tab === t.id ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
            <span className="font-mono text-zinc-500">{t.icon}</span>{t.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">live · GST</span>
      </div>
      <div className="max-h-[260px] overflow-auto px-4 py-3">
        {LOGS[tab].map((l, i) => (
          <div key={i} className="flex gap-3 py-0.5 font-mono text-[11.5px] leading-relaxed">
            <span className="shrink-0 text-zinc-600">{l.t}</span>
            <span className={l.cls}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MOBILE — the MD desk on a phone. Single column, bottom nav, order as a
// full-screen sheet, positions as tap-cards. Reuses the same data + helpers.
// ════════════════════════════════════════════════════════════════════════════
function BigStat({ label, value, money, sub }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className="mt-1.5 font-mono text-[22px] font-medium tabular-nums leading-none">
        {money !== undefined ? <Money value={money} /> : <span className="text-zinc-900">{value}</span>}
      </div>
      {sub && <div className="mt-1.5 font-mono text-[10px] tabular-nums text-zinc-400">{sub}</div>}
    </div>
  );
}
function MenuAct({ tone = "zinc", onClick, children }) {
  const map = {
    red: "text-red-700 hover:bg-red-50",
    amber: "text-amber-700 hover:bg-amber-50",
    zinc: "text-zinc-700 hover:bg-zinc-50",
  };
  return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium transition-colors ${map[tone]}`}>{children}</button>;
}
function MobilePosCard({ p, onTap, onAction }) {
  const [open, setOpen] = useState(false);
  const pnl = p.pnl || 0;
  const act = (kind) => { setOpen(false); onAction?.(p, kind); };
  return (
    <div className="relative">
      <button onClick={onTap} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm transition-colors active:bg-zinc-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${p.strategy === "LONG" ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="text-[15px] font-semibold text-zinc-900">{p.symbol}</span>
            <span className="font-mono text-[9px] uppercase tracking-wide text-zinc-400">{p.asset} · {p.strategy}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATE_TONE[p.state]}`}>{p.state.replace(/_/g, " ")}</span>
            <span className="-mr-1.5 w-6" />
          </div>
        </div>
        <div className="mt-2.5 flex items-end justify-between font-mono tabular-nums">
          <div className="flex gap-4">
            <div><div className="text-[8px] uppercase tracking-[0.14em] text-zinc-400">Qty</div><div className="text-[13px] text-zinc-700">{p.qty ? p.qty.toLocaleString() : "flat"}</div></div>
            <div><div className="text-[8px] uppercase tracking-[0.14em] text-zinc-400">Last</div><div className="text-[13px] text-zinc-900">{p.last}</div></div>
            <div><div className="text-[8px] uppercase tracking-[0.14em] text-zinc-400">Value</div><div className="text-[13px] text-zinc-700">{p.qty ? fmtUsd(p.last * p.qty) : "—"}</div></div>
          </div>
          <div className="text-right"><div className="text-[8px] uppercase tracking-[0.14em] text-zinc-400">P&L</div><div className="text-[14px]">{pnl ? <Money value={pnl} /> : <span className="text-zinc-300">—</span>}</div></div>
        </div>
      </button>

      {/* kebab — same actions as the desktop hover row */}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Actions"
        className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor"><circle cx="8" cy="3" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="8" cy="13" r="1.3" /></svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-30" />
          <div className="absolute right-2.5 top-10 z-40 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl shadow-zinc-200/70">
            {p.qty ? <MenuAct tone="red" onClick={() => act("Square off")}>Square off</MenuAct> : null}
            <MenuAct tone="amber" onClick={() => act("Cancel orders")}>Cancel orders</MenuAct>
            <MenuAct onClick={() => act("Modify stop")}>Modify stop</MenuAct>
            <MenuAct onClick={() => { setOpen(false); onTap(); }}>Details</MenuAct>
          </div>
        </>
      )}
    </div>
  );
}

// ── slide-over menu (scales as views grow — replaces the bottom bar) ─────────
const MENU_ICONS = {
  home: <path d="M2.5 7.5L8 3l5.5 4.5M4 6.8V13h8V6.8" />,
  positions: <><rect x="2.5" y="3" width="11" height="3" rx="1" /><rect x="2.5" y="7.5" width="11" height="3" rx="1" /><rect x="2.5" y="12" width="7" height="1.6" rx="0.8" /></>,
  activity: <path d="M2 8h2.4l1.6-4 2.4 8 1.8-5 1.2 1h2.6" />,
  logs: <><rect x="2.5" y="2.8" width="11" height="10.4" rx="1.5" /><path d="M5 6l1.6 1.4L5 8.8M8.4 9.2h2.6" /></>,
  statements: <><path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13z" /><path d="M9 2.5V5.5h3M6 8.5h4M6 10.5h4" /></>,
  settings: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" /></>,
};
const MENU_ITEMS = [
  ["home", "Overview", "Desk P&L, exposure, live curve"],
  ["positions", "Positions", "Open strategies & brackets"],
  ["activity", "Activity", "Alerts, guards, session events"],
  ["logs", "System Logs", "Sandbox · algorithm · trader data"],
  ["statements", "Statements", "Daily P&L & commission rollup"],
  ["settings", "Settings", "Account, risk gates, connection"],
];
function MenuScreen({ open, onClose, tab, setTab, account, badges = {} }) {
  return (
    <div className={`fixed inset-0 z-[95] transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}>
      <div onClick={onClose} className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" />
      <div className={`absolute inset-y-0 right-0 flex w-[84%] max-w-[340px] flex-col bg-zinc-950 text-white shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-white font-mono text-[12px] font-bold text-zinc-900">GT</div>
            <div className="leading-tight"><div className="text-[13px] font-semibold">GT Capital</div><div className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/40">Desk · MD</div></div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-white/60 transition-colors hover:border-white/40 hover:text-white">✕</button>
        </div>
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/40">Equity · Day P&L</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-[19px] font-medium">{fmtUsd(account.equity)}</span>
            <span className={`text-[13px] ${account.dayPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{account.dayPnl >= 0 ? "+" : ""}{account.dayPnl.toLocaleString()}</span>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {MENU_ITEMS.map(([id, label, desc]) => {
            const on = tab === id;
            return (
              <button key={id} onClick={() => { setTab(id); onClose(); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${on ? "bg-white/10" : "hover:bg-white/5"}`}>
                <svg viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 ${on ? "text-white" : "text-white/45"}`} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">{MENU_ICONS[id]}</svg>
                <div className="min-w-0 flex-1"><div className={`text-[13px] font-medium ${on ? "text-white" : "text-white/80"}`}>{label}</div><div className="truncate text-[10px] text-white/35">{desc}</div></div>
                {badges[id] > 0 && <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] text-amber-300">{badges[id]}</span>}
                {on && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-white/10 px-5 py-4 font-mono text-[10px] text-white/40">
          <div className="flex items-center justify-between"><span>TWS 127.0.0.1:7497</span><span className="h-2 w-2 rounded-full bg-emerald-400" /></div>
          <div className="mt-1 text-white/25">paper · demo data · v0.1</div>
        </div>
      </div>
    </div>
  );
}

// ── floating "+" action button — start an engine from anywhere ──────────────
function StartEngineBar({ onStart }) {
  return (
    <button
      onClick={onStart}
      aria-label="Start an engine"
      className="group fixed bottom-[calc(env(safe-area-inset-bottom)+20px)] right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-zinc-900 text-white shadow-xl shadow-zinc-900/25 transition-all hover:bg-zinc-800 active:scale-95"
    >
      {/* soft pulse ring */}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/15" />
      <span className="pointer-events-none absolute -inset-1 rounded-full bg-zinc-900/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <svg viewBox="0 0 24 24" className="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}

// ── Dynamic-Island order tracker — morphing pill showing live approval status ─
function IslandGlyph({ status, small }) {
  const sz = small ? "h-5 w-5" : "h-6 w-6";
  if (status === "APPROVED")
    return <span className={`grid ${sz} shrink-0 place-items-center rounded-full bg-emerald-500/20`}><svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-6.5" /></svg></span>;
  if (status === "REJECTED")
    return <span className={`grid ${sz} shrink-0 place-items-center rounded-full bg-red-500/20`}><svg viewBox="0 0 16 16" className="h-3 w-3 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg></span>;
  return <span className={`grid ${sz} shrink-0 place-items-center rounded-full bg-amber-500/15`}><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" /></span>;
}
function DynamicIsland({ items }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const latest = items[0];
  const pendingCount = items.filter((i) => i.status === "PENDING").length;
  const headline = latest.status === "APPROVED" ? "Approved by desk" : latest.status === "REJECTED" ? "Declined by desk" : "Awaiting admin approval";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-4">
      <button onClick={() => setOpen((o) => !o)} className="pointer-events-auto w-full max-w-[340px] overflow-hidden rounded-[26px] bg-black text-white shadow-2xl shadow-black/40 ring-1 ring-white/10 transition-all duration-300">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <IslandGlyph status={latest.status} />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[12px] font-semibold">{headline}</div>
            <div className="truncate font-mono text-[10px] text-white/50">{latest.symbol} · {latest.label}</div>
          </div>
          {pendingCount > 0 && <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] text-amber-300">{pendingCount}</span>}
          <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
        </div>
        {open && (
          <div className="space-y-0.5 border-t border-white/10 px-2 py-2">
            {items.slice(0, 6).map((i) => (
              <div key={i.id} className="flex items-center gap-2.5 rounded-2xl px-2 py-1.5">
                <IslandGlyph status={i.status} small />
                <div className="min-w-0 flex-1 text-left"><div className="truncate text-[12px]">{i.symbol}</div><div className="truncate font-mono text-[9px] text-white/40">{i.label}</div></div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] ${i.status === "APPROVED" ? "bg-emerald-400/15 text-emerald-300" : i.status === "REJECTED" ? "bg-red-400/15 text-red-300" : "bg-amber-400/15 text-amber-300"}`}>{i.status === "APPROVED" ? "Approved" : i.status === "REJECTED" ? "Declined" : "Pending"}</span>
              </div>
            ))}
          </div>
        )}
      </button>
    </div>
  );
}

// ── persistent "awaiting approval" queue — real desk sign-off has a delay ────
function fmtWait(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function PendingApproval({ items }) {
  if (!items.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
      <div className="flex items-center justify-between border-b border-amber-200/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Awaiting Desk Approval</span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-amber-700">{items.length}</span>
      </div>
      <div className="divide-y divide-amber-200/60">
        {items.map((o) => (
          <div key={o.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-zinc-900">{o.symbol}</span><span className="truncate font-mono text-[10px] text-zinc-500">{o.label}</span></div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber-600">Submitted · not yet confirmed by desk</div>
            </div>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber-700">{fmtWait(o.id)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MdMobile() {
  const data = useMdData(); // live backend when up, demo otherwise
  const { account, pnl_series, position_series, positions, alerts } = data;
  const [tab, setTab] = useState("positions");
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [order, setOrder] = useState(ORDER0);
  const [pending, setPending] = useState([]);
  const [assetFilter, setAssetFilter] = useState("ALL");
  const [stratFilter, setStratFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("TODAY");
  const [assetFilterOpen, setAssetFilterOpen] = useState(false);
  const [stratFilterOpen, setStratFilterOpen] = useState(false);
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const s = useSession();
  const TITLES = { home: "Overview", positions: "Positions", activity: "Activity", logs: "System Logs", statements: "Statements", settings: "Settings" };

  // MD submits → order sits PENDING desk approval → desk confirms.
  // Live: POST /api/launch-intents, then the poller below reflects the desk's
  // decision. Demo (no backend): simulate the approval so the UX still shows.
  async function handlePlaced({ symbol, label }) {
    setSheet(false);
    try {
      const rec = await submitLaunchIntent(order);
      setPending((list) => [{ id: rec.id, symbol: rec.symbol, label, status: "PENDING" }, ...list].slice(0, 8));
    } catch {
      const id = String(Date.now());
      setPending((list) => [{ id, symbol, label, status: "PENDING" }, ...list].slice(0, 8));
      setTimeout(() => {
        setPending((list) => list.map((o) => (o.id === id ? { ...o, status: "APPROVED" } : o)));
        notify("success", `Desk approved · ${symbol}`);
        setTimeout(() => setPending((list) => list.filter((o) => o.id !== id)), 4000);
      }, 10000);
    }
  }

  // Live approval poller: when the backend is up it OWNS the pending list —
  // pending + freshly-decided (last 8s so the island fades). Demo mode: the
  // fetch throws, we leave the locally-simulated pending untouched.
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const intents = await fetchIntents();
        if (!alive) return;
        const now = Date.now();
        const mapped = intents
          .filter((i) => i.status === "PENDING_APPROVAL" || (i.decided_at && now - Date.parse(i.decided_at) < 8000))
          .slice(0, 8)
          .map((i) => ({
            id: i.id,
            symbol: i.symbol,
            label: `${i.side === "SHORT" ? "Short" : "Long"} Breakout · ${i.symbol} · ${i.qty} units`,
            status: i.status === "PENDING_APPROVAL" ? "PENDING"
              : (i.status === "APPROVED" || i.status === "LAUNCHED") ? "APPROVED" : "REJECTED",
          }));
        setPending(mapped);
      } catch { /* demo mode — keep local simulated pending */ }
    }
    poll();
    const iv = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const openCount = positions.filter((p) => p.qty).length;
  const actOn = (p, kind) => notify(kind === "Modify stop" ? "info" : "warning", `${kind} · ${p.symbol}`);
  const squareAll = () => notify("warning", `Close all · ${openCount} position${openCount === 1 ? "" : "s"}`);

  return (
    <div className="min-h-screen bg-zinc-100 pb-24 text-zinc-900">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200 bg-zinc-100/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 font-mono text-[11px] font-bold text-white">GT</div>
          <div><div className="text-[13px] font-semibold leading-none">{TITLES[tab]}</div><div className="mt-1 text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-400">Paper · MD</div></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-1"><span className={`h-1.5 w-1.5 rounded-full ${s.tone}`} /><span className="font-mono text-[9px] tabular-nums text-zinc-500">{s.clock}</span></span>
          <button onClick={() => setMenu(true)} aria-label="Menu" className="grid h-8 w-8 place-items-center rounded-full border border-zinc-200 bg-white transition-colors hover:border-zinc-400">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h10M3 8h10M3 11h10" /></svg>
          </button>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* pinned across every tab so queued orders never get lost during the wait */}
        <PendingApproval items={pending.filter((o) => o.status === "PENDING")} />

        {tab === "home" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <BigStat label="Equity" value={fmtUsd(account.equity)} sub={`${account.bots} strategies live`} />
              <BigStat label="Day P&L" money={account.dayPnl} sub={`${account.dayPnlPct >= 0 ? "+" : ""}${account.dayPnlPct.toFixed(2)}%`} />
            </div>
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[["Exposure", fmtUsd(account.exposure)], ["BP Used", `${account.bpUsedPct.toFixed(1)}%`], ["Win Rate", `${account.winRate}%`], ["Positions", String(account.open)]].map(([l, v]) => (
                <div key={l} className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm">
                  <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-zinc-400">{l}</div>
                  <div className="mt-1 font-mono text-[15px] tabular-nums text-zinc-900">{v}</div>
                </div>
              ))}
            </div>
            <Card title="Cumulative P&L — Today" right={<span className="font-mono text-[11px] tabular-nums"><Money value={account.dayPnl} /></span>}>
              <PnlChart pnlSeries={pnl_series} marker={pnl_series.at(-1).timestamp} />
            </Card>
            <Card title="Net Position — Today"><PositionChart series={position_series} /></Card>
            <div>
              <div className="mb-2 flex items-center justify-between px-1"><Label>Positions & Strategies</Label><span className="font-mono text-[10px] text-zinc-400">{positions.length}</span></div>
              <div className="space-y-2">{positions.slice(0, 4).map((p) => <MobilePosCard key={p.symbol} p={p} onTap={() => setDetail(p)} onAction={actOn} />)}</div>
              <button onClick={() => setTab("positions")} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 transition-colors active:bg-zinc-50">View all {positions.length} →</button>
            </div>
          </>
        )}

        {tab === "positions" && (() => {
          const shown = positions.filter((p) => (assetFilter === "ALL" || p.asset === assetFilter) && (stratFilter === "ALL" || p.strategy === stratFilter));
          // dropdown options — same scalable design as the New Order menu
          const assetFilterOpts = [{ id: "ALL", name: "All assets", desc: "Every class" }, ...ASSETS];
          const stratFilterOpts = [
            { id: "ALL", name: "All strategies", desc: "Long & short" },
            ...STRATEGIES.map((st) => ({
              id: st.side, name: st.name, desc: st.desc,
              dot: st.side === "LONG" ? "bg-emerald-500" : "bg-red-500", badge: st.side,
              badgeCls: st.side === "LONG" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700",
            })),
          ];
          const dateFilterOpts = [
            { id: "TODAY", name: "Today", desc: "Current session" },
            { id: "WEEK", name: "This week", desc: "Last 7 days" },
            { id: "MONTH", name: "This month", desc: "Last 30 days" },
            { id: "ALL", name: "All time", desc: "Full history" },
          ];
          const curAssetFilter = assetFilterOpts.find((o) => o.id === assetFilter) ?? assetFilterOpts[0];
          const curStratFilter = stratFilterOpts.find((o) => o.id === stratFilter) ?? stratFilterOpts[0];
          const curDateFilter = dateFilterOpts.find((o) => o.id === dateFilter) ?? dateFilterOpts[0];
          return (
            <div className="space-y-2">
              {/* Strategy stays visible; Period + Asset tuck behind a filter toggle */}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <FancySelect label="Strategy" current={curStratFilter} options={stratFilterOpts} open={stratFilterOpen} setOpen={setStratFilterOpen} onSelect={setStratFilter} />
                </div>
                <div className="shrink-0">
                  <button
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-label="More filters"
                    className={`relative grid h-[46px] w-[46px] place-items-center rounded-xl border transition-colors ${filtersOpen ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"}`}
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h8M2 11h5" /><circle cx="12" cy="5" r="1.7" /><circle cx="9" cy="11" r="1.7" /></svg>
                    {(dateFilter !== "TODAY" || assetFilter !== "ALL") && !filtersOpen && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-100 bg-amber-400" />}
                  </button>
                </div>
              </div>
              {filtersOpen && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm">
                  <FancySelect label="Period" current={curDateFilter} options={dateFilterOpts} open={dateFilterOpen} setOpen={setDateFilterOpen} onSelect={setDateFilter} />
                  <FancySelect label="Asset" current={curAssetFilter} options={assetFilterOpts} open={assetFilterOpen} setOpen={setAssetFilterOpen} onSelect={setAssetFilter} />
                </div>
              )}
              {openCount > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">{shown.length} shown · {openCount} open</span>
                  <button onClick={squareAll} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-red-700 transition-colors active:bg-red-100">Close all</button>
                </div>
              )}
              {shown.map((p) => <MobilePosCard key={p.symbol} p={p} onTap={() => setDetail(p)} onAction={actOn} />)}
              {shown.length === 0 && <div className="py-10 text-center font-mono text-[11px] text-zinc-400">No positions match.</div>}
            </div>
          );
        })()}
        {tab === "activity" && (
          <Alerts alerts={[
            ...pending.map((o) => ({
              sev: o.status === "APPROVED" ? "LOW" : "MEDIUM",
              code: o.status === "APPROVED" ? "ORDER_APPROVED" : "ORDER_PENDING",
              symbol: o.symbol,
              msg: o.status === "APPROVED" ? `Approved by desk · ${o.label}` : `Submitted for desk approval · ${o.label}`,
              ago: "now",
            })),
            ...alerts,
          ]} />
        )}
        {tab === "logs" && <SystemLogs />}
        {(tab === "statements" || tab === "settings") && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-zinc-300 bg-white/50 px-6 py-16 text-center">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">{TITLES[tab]}</div>
            <div className="mt-1 text-[12px] text-zinc-400">Coming soon.</div>
          </div>
        )}
      </main>

      <DynamicIsland items={pending} />
      <MenuScreen open={menu} onClose={() => setMenu(false)} tab={tab} setTab={setTab} account={account} badges={{ activity: pending.filter((o) => o.status === "PENDING").length }} />
      <StartEngineBar onStart={() => setSheet(true)} />
      {sheet && <OrderSheet order={order} setOrder={setOrder} onClose={() => setSheet(false)} onPlaced={handlePlaced} approval />}
      {detail && (
        <PositionDetail p={detail} onClose={() => setDetail(null)} onOrder={(pp) => { setOrder((o) => toStrat(pp, o)); setDetail(null); setSheet(true); }} />
      )}
      {/* island owns the top; Sileo toasts pop from the bottom so they don't fight */}
      <Toaster position="bottom-center" theme="light" />
    </div>
  );
}

// shared default order shape + a tiny full-screen order sheet for mobile variants
const ORDER0 = {
  mode: "STRATEGY", strategyId: "long_breakout", asset: "EQUITY", symbol: "NVDA",
  qty: "100", value: "10000", sizeMode: "QTY", trigger: "0",
  stop: "0.05", stopUnit: "PCT", offset: "0.05", offsetUnit: "ABS",
  orderType: "MKT", limitPrice: "0", stopPrice: "0", tif: "DAY",
};
function OrderSheet({ order, setOrder, onClose, onPlaced, approval }) {
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <span className="text-[13px] font-semibold">New Order</span>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-zinc-200 text-zinc-500">✕</button>
      </div>
      <div className="flex-1 overflow-auto p-4"><OrderTicket order={order} setOrder={setOrder} fromSymbol={null} onClear={() => {}} onPlaced={onPlaced} approval={approval} /></div>
    </div>
  );
}
function toStrat(p, o) {
  return { ...o, mode: "STRATEGY", strategyId: p.strategy === "SHORT" ? "short_breakout" : "long_breakout", asset: p.asset, symbol: p.symbol, qty: String(p.qty || 100) };
}

// ── mobile ② — FOCUS DECK: hero P&L + swipeable position cards ───────────────
export function MdMobileFocus() {
  const [data] = useState(() => generateMdData());
  const { account, pnl_series, positions } = data;
  const [detail, setDetail] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [order, setOrder] = useState(ORDER0);
  const s = useSession();
  const up = account.dayPnl >= 0;
  return (
    <div className="min-h-screen bg-zinc-100 pb-24 text-zinc-900">
      <header className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 font-mono text-[11px] font-bold text-white">GT</div>
          <span className="text-[13px] font-semibold">Trading Desk</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1"><span className={`h-1.5 w-1.5 rounded-full ${s.tone}`} /><span className="font-mono text-[9px] tabular-nums text-zinc-500">{s.clock}</span></span>
      </header>

      {/* hero */}
      <div className="px-5 pt-4 text-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Day P&L · Paper</div>
        <div className={`mt-1 font-mono text-[46px] font-medium leading-none tabular-nums ${up ? "text-[color:var(--color-up)]" : "text-[color:var(--color-down)]"}`}>{up ? "+" : ""}{account.dayPnl.toLocaleString()}</div>
        <div className="mt-2 font-mono text-[12px] tabular-nums text-zinc-400">{fmtUsd(account.equity)} equity · {up ? "+" : ""}{account.dayPnlPct.toFixed(2)}% · {account.open} open</div>
      </div>
      <div className="px-2 pt-2"><PnlChart pnlSeries={pnl_series} marker={pnl_series.at(-1).timestamp} /></div>

      {/* swipeable deck */}
      <div className="mt-2 px-1"><Label>Positions · swipe</Label></div>
      <div className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {positions.map((p) => {
          const pnl = p.pnl || 0;
          return (
            <div key={p.symbol} className="w-[84%] shrink-0 snap-center rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${p.strategy === "LONG" ? "bg-emerald-500" : "bg-red-500"}`} /><span className="text-[16px] font-semibold">{p.symbol}</span><span className="font-mono text-[9px] uppercase text-zinc-400">{p.asset}·{p.strategy}</span></div>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATE_TONE[p.state]}`}>{p.state.replace(/_/g, " ")}</span>
              </div>
              <div className={`mt-3 font-mono text-[30px] font-medium tabular-nums ${pnl > 0 ? "text-[color:var(--color-up)]" : pnl < 0 ? "text-[color:var(--color-down)]" : "text-zinc-300"}`}>{pnl ? <Money value={pnl} /> : "—"}</div>
              <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-[12px] tabular-nums">
                {[["Qty", p.qty || "flat"], ["Entry", p.entry], ["Last", p.last], ["Stop", p.stop]].map(([l, v]) => (
                  <div key={l}><div className="text-[8px] uppercase tracking-[0.14em] text-zinc-400">{l}</div><div className="text-zinc-800">{v}</div></div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => notify("warning", `Square off · ${p.symbol}`)} className="flex-1 rounded-xl border border-red-200 bg-red-50 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">Square off</button>
                <button onClick={() => setDetail(p)} className="flex-1 rounded-xl bg-zinc-900 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white">Details</button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => setSheet(true)} className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-zinc-900 px-6 py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-xl shadow-zinc-300">+ New Order</button>
      {sheet && <OrderSheet order={order} setOrder={setOrder} onClose={() => setSheet(false)} />}
      {detail && <PositionDetail p={detail} onClose={() => setDetail(null)} onOrder={(pp) => { setOrder((o) => toStrat(pp, o)); setDetail(null); setSheet(true); }} />}
      <Toaster position="top-center" theme="light" />
    </div>
  );
}

// ── mobile ③ — COMMAND: order ticket is the hero, positions below ────────────
export function MdMobileCommand() {
  const [data] = useState(() => generateMdData());
  const { account, positions } = data;
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState(ORDER0);
  const s = useSession();
  const up = account.dayPnl >= 0;
  return (
    <div className="min-h-screen bg-zinc-100 pb-6 text-zinc-900">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200 bg-zinc-100/90 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 font-mono text-[11px] font-bold text-white">GT</div><span className="text-[13px] font-semibold">Command</span></div>
        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-zinc-500">{fmtUsd(account.equity)}</span>
          <span className={up ? "text-[color:var(--color-up)]" : "text-[color:var(--color-down)]"}>{up ? "+" : ""}{account.dayPnl.toLocaleString()}</span>
          <span className={`h-1.5 w-1.5 rounded-full ${s.tone}`} />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        <OrderTicket order={order} setOrder={setOrder} fromSymbol={null} onClear={() => {}} />
        <div>
          <div className="mb-2 flex items-center justify-between px-1"><Label>Open Positions</Label><span className="font-mono text-[10px] text-zinc-400">{positions.filter((p) => p.qty).length}</span></div>
          <div className="space-y-2">
            {positions.map((p) => <MobilePosCard key={p.symbol} p={p} onTap={() => setDetail(p)} />)}
          </div>
        </div>
      </main>
      {detail && <PositionDetail p={detail} onClose={() => setDetail(null)} onOrder={(pp) => { setOrder((o) => toStrat(pp, o)); setDetail(null); }} />}
      <Toaster position="top-center" theme="light" />
    </div>
  );
}

// Asset classes — data-driven so options/futures/spot slot in later.
const ASSETS = [
  { id: "EQUITY", name: "Equity", desc: "US stocks · shares" },
  { id: "FX", name: "Forex", desc: "Spot currency pairs" },
  { id: "CFD", name: "CFD", desc: "Index & single-stock CFDs" },
];

// ── reusable intuitive dropdown (dot · name · badge · description) ───────────
function FancySelect({ label, current, options, open, setOpen, onSelect }) {
  const row = (o, active) => (
    <>
      {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[13px] text-zinc-900 ${active ? "font-semibold" : "font-medium"}`}>{o.name}</span>
          {o.badge && <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] ${o.badgeCls}`}>{o.badge}</span>}
        </div>
        {o.desc && <div className="truncate font-mono text-[10px] text-zinc-400">{o.desc}</div>}
      </div>
    </>
  );
  return (
    <div className="relative">
      <Label>{label}</Label>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 flex w-full items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-zinc-300">
        {row(current, true)}
        <svg viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-10" />
          <div className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl shadow-zinc-200/70">
            {options.map((o) => {
              const on = o.id === current.id;
              return (
                <button key={o.id} onClick={() => { onSelect(o.id); setOpen(false); }} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${on ? "bg-zinc-50" : "hover:bg-zinc-50"}`}>
                  {row(o, false)}
                  {on && <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-zinc-900" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-6.5" /></svg>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── order ticket (the MD's key action) ──────────────────────────────────────
function OrderTicket({ order, setOrder, fromSymbol, onClear, onPlaced, approval }) {
  const [placed, setPlaced] = useState(null);
  const [stratOpen, setStratOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const set = (k, v) => setOrder((o) => ({ ...o, [k]: v }));
  const {
    mode = "STRATEGY", strategyId = "long_breakout", asset, symbol, qty, value,
    sizeMode = "QTY", trigger, stop, offset, orderType = "MKT", limitPrice, stopPrice, tif = "DAY",
  } = order;
  const strat = STRATEGIES.find((s) => s.id === strategyId) ?? STRATEGIES[0];
  const stratOpts = STRATEGIES.map((s) => ({
    id: s.id, name: s.name, desc: s.desc,
    dot: s.side === "LONG" ? "bg-emerald-500" : "bg-red-500", badge: s.side,
    badgeCls: s.side === "LONG" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700",
  }));
  const curStrat = stratOpts.find((o) => o.id === strategyId) ?? stratOpts[0];
  const curAsset = ASSETS.find((a) => a.id === asset) ?? ASSETS[0];
  const needsLimit = orderType === "LMT" || orderType === "STP LMT";
  const needsStop = orderType === "STP" || orderType === "STP LMT";
  const sizeLabel = sizeMode === "QTY" ? `${qty} units` : `$${Number(value || 0).toLocaleString()}`;

  function place() {
    const label = mode === "STRATEGY"
      ? `${strat.name} · ${symbol} · ${sizeLabel}`
      : `${mode} ${sizeLabel} ${symbol} @ ${orderType}`;
    setPlaced(label);
    if (approval) notify("info", `Submitted · ${symbol}`);
    else notify("success", `Order sent · ${symbol}`);
    onPlaced?.({ symbol, label });
    setTimeout(() => setPlaced(null), 2600);
  }

  const field = "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-mono text-[14px] tabular-nums text-zinc-900 outline-none transition-colors focus:border-zinc-400";
  const seg = "mt-1.5 inline-flex w-full gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-1";
  const segBtn = (on, tone) => `flex-1 rounded-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${on ? tone : "text-zinc-500 hover:text-zinc-900"}`;
  // plain functions (NOT components) so inputs don't remount + lose focus on keystroke
  const fld = (label, k) => (
    <div><Label>{label}</Label><input value={order[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={`${field} mt-1.5`} /></div>
  );
  // Size input with a QTY / $ VALUE toggle — enter shares/units OR a dollar notional.
  const sizeField = () => (
    <div>
      <div className="flex items-center justify-between">
        <Label>Size</Label>
        <div className="inline-flex gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
          {[["QTY", "Qty"], ["VALUE", "$ Value"]].map(([v, lbl]) => (
            <button key={v} onClick={() => set("sizeMode", v)} className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${sizeMode === v ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-700"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center rounded-xl border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400">
        {sizeMode === "VALUE" && <span className="pl-3 font-mono text-[14px] text-zinc-400">$</span>}
        <input value={sizeMode === "QTY" ? qty : value} onChange={(e) => set(sizeMode === "QTY" ? "qty" : "value", e.target.value)} className="w-full bg-transparent px-3 py-2.5 font-mono text-[14px] tabular-nums text-zinc-900 outline-none" />
        <span className="pr-3 font-mono text-[9px] uppercase tracking-wide text-zinc-400">{sizeMode === "QTY" ? "units" : "USD"}</span>
      </div>
    </div>
  );
  // Field with a % / VAL unit toggle — for Stop, Offset, etc.
  const unitField = (label, valKey, unitKey) => {
    const u = order[unitKey] ?? "PCT";
    return (
      <div>
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <div className="inline-flex gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
            {[["PCT", "%"], ["ABS", "Val"]].map(([v, lbl]) => (
              <button key={v} onClick={() => set(unitKey, v)} className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${u === v ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-700"}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex items-center rounded-xl border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400">
          <input value={order[valKey] ?? ""} onChange={(e) => set(valKey, e.target.value)} className="w-full bg-transparent px-3 py-2.5 font-mono text-[14px] tabular-nums text-zinc-900 outline-none" />
          <span className="pr-3 font-mono text-[10px] text-zinc-400">{u === "PCT" ? "%" : "abs"}</span>
        </div>
      </div>
    );
  };

  const cta = mode === "BUY"
    ? { cls: "bg-emerald-600 shadow-emerald-200 hover:bg-emerald-700", label: `Buy ${symbol}` }
    : mode === "SELL"
    ? { cls: "bg-red-600 shadow-red-200 hover:bg-red-700", label: `Sell ${symbol}` }
    : { cls: "bg-zinc-900 shadow-zinc-200 hover:bg-zinc-800", label: `Deploy ${strat.name} · ${symbol}` };

  return (
    <Card
      title="New Order"
      subtitle={fromSymbol ? `Loaded from ${fromSymbol} position` : "Place from anywhere · paper account"}
      right={fromSymbol ? (
        <button onClick={onClear} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-700">Clear</button>
      ) : null}
    >
      <div className="space-y-3.5">
        {/* strategy → asset → symbol (all common; strategy leads) */}
        <FancySelect label="Strategy" current={curStrat} options={stratOpts} open={stratOpen} setOpen={setStratOpen} onSelect={(id) => set("strategyId", id)} />
        <FancySelect label="Asset" current={curAsset} options={ASSETS} open={assetOpen} setOpen={setAssetOpen} onSelect={(id) => set("asset", id)} />
        <div>
          <Label>Symbol</Label>
          <input value={symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} className={`${field} mt-1.5 uppercase`} />
        </div>

        {mode === "STRATEGY" ? (
          <>
            {sizeField()}
            {fld("Trigger", "trigger")}
            <div className="grid grid-cols-2 gap-2">
              {unitField("Stop", "stop", "stopUnit")}
              {unitField("Offset", "offset", "offsetUnit")}
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
              <span className={strat.side === "LONG" ? "text-emerald-700" : "text-red-700"}>{strat.desc}</span> · trigger {trigger || "—"} · stop {stop}{order.stopUnit === "PCT" ? "%" : ""} · offset {offset}{order.offsetUnit === "PCT" ? "%" : ""}
            </div>
          </>
        ) : (
          <>
            <div>
              <Label>Order Type</Label>
              <div className={seg}>
                {["MKT", "LMT", "STP", "STP LMT"].map((v) => (
                  <button key={v} onClick={() => set("orderType", v)} className={segBtn(orderType === v, "bg-zinc-900 text-white")}>{v}</button>
                ))}
              </div>
            </div>
            {sizeField()}
            {(needsLimit || needsStop) && (
              <div className="grid grid-cols-2 gap-2">
                {needsLimit && fld("Limit", "limitPrice")}
                {needsStop && fld("Stop Px", "stopPrice")}
              </div>
            )}
            <div>
              <Label>Time in Force</Label>
              <div className={seg}>
                {["DAY", "GTC", "IOC"].map((v) => (
                  <button key={v} onClick={() => set("tif", v)} className={segBtn(tif === v, "bg-zinc-900 text-white")}>{v}</button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
              <span className={mode === "BUY" ? "text-emerald-700" : "text-red-700"}>{mode} {sizeLabel} {symbol}</span> @ {orderType === "MKT" ? "market" : orderType.toLowerCase()}
              {needsLimit ? ` ${limitPrice}` : ""}{needsStop ? ` · stp ${stopPrice}` : ""} · {tif}
            </div>
          </>
        )}

        <button onClick={place} className={`flex w-full items-center justify-center rounded-2xl py-4 text-xs font-bold uppercase tracking-widest text-white shadow-xl transition-all active:scale-[0.99] ${approval ? "bg-zinc-900 shadow-zinc-200 hover:bg-zinc-800" : cta.cls}`}>
          {placed ? (approval ? "Submitted ✓" : "Order Sent ✓") : (approval ? "Submit for Approval" : cta.label)}
        </button>
        {approval && !placed && (
          <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="7" width="9" height="6" rx="1.2" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>
            Order requires desk confirmation
          </div>
        )}
        {placed && <div className={`rounded-lg border px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] ${approval ? "border-amber-300 bg-amber-100 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{approval ? "Pending admin approval" : "Working"}: {placed}</div>}
      </div>
    </Card>
  );
}

// ── alerts feed ──────────────────────────────────────────────────────────────
function Alerts({ alerts }) {
  return (
    <Card title="Activity" right={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">{alerts.length}</span>}>
      <div className="space-y-px">
        {alerts.map((a, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-zinc-50">
            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${SEV_TONE[a.sev]}`}>{a.sev}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-600">{a.code}</span>
                <span className="font-mono text-[10px] text-zinc-400">{a.symbol}</span>
              </div>
              <div className="truncate text-[12px] text-zinc-600">{a.msg}</div>
            </div>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">{a.ago}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
