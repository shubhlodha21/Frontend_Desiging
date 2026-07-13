import { useMemo, useState } from "react";
import { parseLog, generateDemoData } from "./lib/parseLog.js";
import { usePlayback } from "./lib/usePlayback.js";
import { PriceChart, PnlChart } from "./components/Charts.jsx";
import { Transport } from "./components/Transport.jsx";
import { OrderBook } from "./components/OrderBook.jsx";
import { Card, Money, Stat, Chip, Label } from "./components/ui.jsx";

export default function App() {
  const [dataset, setDataset] = useState(() => generateDemoData());
  const [product, setProduct] = useState(dataset.products[0]);

  // ── the single source of truth ──────────────────────────────────────────
  // One hook, one number (currentTick). Everything below reads from it.
  const playback = usePlayback(dataset.timeline.length);
  const { currentTick } = playback;

  const entry = dataset.timeline[currentTick]; // the current snapshot
  const timestamp = entry?.timestamp ?? 0;

  async function onUpload(file) {
    if (!file) return;
    const parsed = parseLog(await file.text());
    if (!parsed) return alert("Couldn't parse that file — expected a ';'-delimited log.");
    setDataset(parsed);
    setProduct(parsed.products[0]);
    playback.seek(0);
  }

  function loadDemo() {
    const d = generateDemoData();
    setDataset(d);
    setProduct(d.products[0]);
    playback.seek(0);
  }

  // Live PnL up to the current tick (derived, not stored).
  const livePnl = entry?.pnl_total ?? 0;
  const peakPnl = useMemo(() => Math.max(...dataset.pnl_series.map((p) => p.total)), [dataset]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <div className="h-6 w-6 rounded bg-zinc-900" />
          <h1 className="text-sm font-semibold text-zinc-800">Prosperity Study</h1>
          <span className="rounded bg-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-500">{dataset.source}</span>
          <label className="ml-auto cursor-pointer rounded-full bg-zinc-900 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white shadow-sm shadow-zinc-200 transition-all hover:bg-zinc-800">
            Upload log
            <input type="file" accept=".txt,.log,.csv" className="hidden" onChange={(e) => onUpload(e.target.files[0])} />
          </label>
          <button onClick={loadDemo} className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900">
            Regenerate demo
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {/* The transport bar drives currentTick for the whole page. */}
        <Transport playback={playback} timestamp={timestamp} />

        {/* Product filter — the reusable Chip in action. */}
        <div className="flex items-center gap-2">
          <Label>Product</Label>
          {dataset.products.map((p) => (
            <Chip key={p} active={p === product} onClick={() => setProduct(p)}>
              {p}
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Charts span 2 columns; order book takes the third — like the real layout. */}
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Live PnL">
                <Money value={livePnl} />
              </Stat>
              <Stat label="Peak PnL">
                <Money value={peakPnl} />
              </Stat>
              <Stat label="Mid">
                <span className="font-mono text-zinc-800">{entry?.products[product]?.mid_price.toFixed(1) ?? "—"}</span>
              </Stat>
              <Stat label="Tick">
                <span className="font-mono text-zinc-800">
                  {currentTick} / {dataset.timeline.length - 1}
                </span>
              </Stat>
            </div>

            <Card title="Mid prices" subtitle="The dashed playhead tracks the current tick across both charts">
              <PriceChart timeline={dataset.timeline} products={dataset.products} marker={timestamp} />
            </Card>

            <Card title="Cumulative PnL">
              <PnlChart pnlSeries={dataset.pnl_series} marker={timestamp} />
            </Card>
          </div>

          {/* This panel has NO timer of its own — it's a pure function of the
              current tick. Press play and watch it redraw in lockstep. */}
          <OrderBook entry={entry} product={product} />
        </div>
      </main>
    </div>
  );
}
