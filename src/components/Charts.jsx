import {
  ComposedChart,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

// A vertical marker at the current playback tick, shared by both charts (same
// syncId + same timestamp = one aligned "playhead").
//
// GOTCHA: Recharts categorizes its children by component TYPE. If you wrap
// <ReferenceLine> in your own component, Recharts can't find it and silently
// drops it. So we render ReferenceLine DIRECTLY inside each chart (below).
const playhead = (marker) =>
  marker != null ? (
    <ReferenceLine x={marker} stroke="#18181b" strokeDasharray="3 3" strokeWidth={1} />
  ) : null;

// ────────────────────────────────────────────────────────────────────────────
// THE key technique: SYNC_ID.
//
// Every chart that shares this id shares a hover cursor. Move the mouse over the
// price chart and the PnL chart highlights the SAME timestamp. This one prop is
// what makes a stack of separate charts feel like a single instrument — and it's
// exactly what the original does (6 synced charts in the real bundle).
// ────────────────────────────────────────────────────────────────────────────
const SYNC_ID = "prosperity";

// Muted zinc chart chrome — the grid/axes recede so the data lines stand out.
const AXIS = { stroke: "#a1a1aa", fontSize: 11, fontFamily: "JetBrains Mono" };
const GRID = "#e4e4e7";
const SERIES_COLORS = ["#3f3f46", "#0ea5e9", "#f59e0b", "#8b5cf6"];

// A shared tooltip so both charts read identically — dark zinc card, mono numbers.
function DataTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-1 font-mono text-zinc-400">t = {label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 font-mono">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name}</span>
          <span className="ml-auto font-medium text-white">
            {Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PriceChart({ timeline, products, marker }) {
  // Flatten the timeline into rows Recharts can read: one key per product mid.
  const data = timeline.map((t) => {
    const row = { timestamp: t.timestamp };
    for (const p of products) row[p] = t.products[p]?.mid_price ?? null;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {/* number (not category) axis so the playhead can sit at any timestamp */}
        <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="linear" {...AXIS} tickLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
        <Tooltip content={<DataTooltip />} />
        {playhead(marker)}
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono" }} />
        {products.map((p, i) => (
          <Line
            key={p}
            type="monotone"
            dataKey={p}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        {/* Brush = drag-to-zoom timeline. Because both charts share syncId, zooming
            one keeps them aligned. */}
        <Brush dataKey="timestamp" height={20} stroke="#a1a1aa" travellerWidth={8} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PnlChart({ pnlSeries, marker }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={pnlSeries} syncId={SYNC_ID} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-up)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-up)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        {/* number (not category) axis so the playhead can sit at any timestamp */}
        <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="linear" {...AXIS} tickLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<DataTooltip />} />
        {playhead(marker)}
        <Area type="monotone" dataKey="total" name="PnL" stroke="var(--color-up)" strokeWidth={1.5} fill="url(#pnlFill)" isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
