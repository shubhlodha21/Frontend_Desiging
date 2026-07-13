// ────────────────────────────────────────────────────────────────────────────
// Data layer.
//
// This is the clean, well-named version of what the original does in minified
// form: parse a semicolon-delimited log by FIXED COLUMN INDICES (no CSV library),
// and provide a synthetic generator so the app has something to show on load.
//
// The output shape below is the exact contract the charts consume — it matches
// the structure decoded from the real bundle:
//   timeline:   [{ timestamp, products: { NAME: { bids, asks, mid_price } }, pnl_by_product, pnl_total }]
//   pnl_series: [{ timestamp, total, by_product: { NAME: number } }]
// ────────────────────────────────────────────────────────────────────────────

const PRODUCTS = ["EMERALDS", "TOMATOES"];

// Parse a legacy-style log: one row per (timestamp, product), fields split on ";".
// Layout (matching the original's index scheme):
//   0 day | 1 timestamp | 2 product | 3..8 bid px/qty ×3 | 9..14 ask px/qty ×3 | 15 mid | 16 pnl
export function parseLog(text) {
  const rows = text.trim().split("\n");
  const byTimestamp = new Map();

  for (const line of rows) {
    const f = line.split(";");
    if (f.length < 17) continue; // skip headers / malformed lines

    const timestamp = Number(f[1]);
    const product = f[2];
    if (!Number.isFinite(timestamp) || !product) continue;

    if (!byTimestamp.has(timestamp)) {
      byTimestamp.set(timestamp, { timestamp, products: {}, pnl_by_product: {} });
    }
    const entry = byTimestamp.get(timestamp);

    entry.products[product] = {
      bids: levels(f, [[3, 4], [5, 6], [7, 8]]),
      asks: levels(f, [[9, 10], [11, 12], [13, 14]]),
      mid_price: Number(f[15]) || 0,
    };
    entry.pnl_by_product[product] = Number(f[16]) || 0;
  }

  const timeline = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (timeline.length === 0) return null;

  finalize(timeline);
  return toDataset(timeline, "uploaded_log");
}

// Read [priceIdx, qtyIdx] pairs into a tidy array of order-book levels.
function levels(f, pairs) {
  return pairs
    .map(([p, q]) => ({ price: Number(f[p]), quantity: Number(f[q]) }))
    .filter((l) => Number.isFinite(l.price) && l.quantity > 0);
}

// Synthetic data: a random walk per product with a live order book, so the
// dashboard is populated on first load (the original ships a "demo" mode too).
export function generateDemoData(steps = 400) {
  const timeline = [];
  const pnl = Object.fromEntries(PRODUCTS.map((p) => [p, 0]));
  const mid = { EMERALDS: 10000, TOMATOES: 5000 };

  for (let i = 0; i < steps; i++) {
    const entry = { timestamp: i * 100, products: {}, pnl_by_product: {} };
    for (const p of PRODUCTS) {
      const drift = p === "TOMATOES" ? Math.sin(i / 10) * 8 : 0;
      mid[p] += (Math.random() - 0.5) * (p === "EMERALDS" ? 2 : 10) + drift * 0.1;
      const m = mid[p];
      entry.products[p] = {
        bids: [1, 2, 3].map((d) => ({ price: Math.floor(m - d), quantity: 10 + Math.floor(Math.random() * 40) })),
        asks: [1, 2, 3].map((d) => ({ price: Math.ceil(m + d), quantity: 10 + Math.floor(Math.random() * 40) })),
        mid_price: m,
      };
      pnl[p] += Math.floor(Math.random() * 100) - 40;
      entry.pnl_by_product[p] = pnl[p];
    }
    timeline.push(entry);
  }
  finalize(timeline);
  return toDataset(timeline, "demo");
}

// Roll product PnL up to a per-timestamp total (done once, not on every render).
function finalize(timeline) {
  for (const t of timeline) {
    t.pnl_total = Object.values(t.pnl_by_product).reduce((a, b) => a + b, 0);
  }
}

function toDataset(timeline, source) {
  const products = [...new Set(timeline.flatMap((t) => Object.keys(t.products)))];
  return {
    source,
    products,
    timeline,
    pnl_series: timeline.map((t) => ({
      timestamp: t.timestamp,
      total: t.pnl_total,
      by_product: t.pnl_by_product,
    })),
  };
}
