import { Card } from "./ui.jsx";

// The order-book ladder for ONE product at the CURRENT tick.
// This is the component that makes playback feel alive: it reads `entry` (the
// current tick's snapshot) and redraws every frame the tick advances. Notice it
// has no timer, no state — it's a pure function of (entry). That's the pattern.
//
// Two techniques worth stealing:
//  1. Depth bars: each row's colored background width ∝ its size / maxSize.
//  2. Market pressure: bidVol / (bidVol + askVol) as a single gradient bar.
export function OrderBook({ entry, product }) {
  const book = entry?.products?.[product];
  if (!book) return <Card title={`Order Book: ${product}`}>No data at this tick.</Card>;

  const asks = [...book.asks].sort((a, b) => b.price - a.price); // high → low
  const bids = [...book.bids].sort((a, b) => b.price - a.price); // high → low
  const bidVol = sum(bids);
  const askVol = sum(asks);
  const maxSize = Math.max(1, ...asks.map((l) => l.quantity), ...bids.map((l) => l.quantity));
  const mid = book.mid_price;
  const spread = (asks.at(-1)?.price ?? 0) - (bids[0]?.price ?? 0); // best ask - best bid
  const pressure = bidVol + askVol > 0 ? bidVol / (bidVol + askVol) : 0.5;

  return (
    <Card title={`Order Book: ${product}`} right={<Spread value={spread} />}>
      <div className="space-y-px font-mono text-xs">
        {asks.map((l, i) => (
          <Level key={`a${i}`} level={l} maxSize={maxSize} side="ask" />
        ))}
        <div className="my-1 flex items-center justify-between rounded bg-zinc-100 px-2 py-1 text-zinc-500">
          <span>MID</span>
          <span className="font-semibold text-zinc-800">{mid.toFixed(1)}</span>
        </div>
        {bids.map((l, i) => (
          <Level key={`b${i}`} level={l} maxSize={maxSize} side="bid" />
        ))}
      </div>

      {/* Market pressure: how much of the visible volume is on the bid side. */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-zinc-400">
          <span>Bids heavy</span>
          <span>Asks heavy</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          <div style={{ width: `${pressure * 100}%` }} className="bg-[color:var(--color-up)]" />
          <div style={{ width: `${(1 - pressure) * 100}%` }} className="bg-[color:var(--color-down)]" />
        </div>
      </div>
    </Card>
  );
}

// One ladder row: price + size, with a depth bar behind it sized to the volume.
function Level({ level, maxSize, side }) {
  const pct = (level.quantity / maxSize) * 100;
  const bar = side === "ask" ? "var(--color-down)" : "var(--color-up)";
  return (
    <div className="relative flex justify-between px-2 py-0.5">
      <div
        className="absolute inset-y-0 right-0 rounded-sm opacity-15"
        style={{ width: `${pct}%`, background: bar }}
      />
      <span className="relative z-10 text-zinc-700">{level.price}</span>
      <span className="relative z-10 text-zinc-500">{level.quantity}</span>
    </div>
  );
}

function Spread({ value }) {
  return (
    <span className="font-mono text-xs text-zinc-500">
      SPREAD <span className="text-zinc-800">{value.toFixed(1)}</span>
    </span>
  );
}

const sum = (levels) => levels.reduce((a, l) => a + l.quantity, 0);
