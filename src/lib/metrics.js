// ────────────────────────────────────────────────────────────────────────────
// MARKET METRICS — reconstructed from the real Prosperity Visualizer bundle.
//
// These are the "mid price" variants her toggle chips expose (ANCHOR MID, WORST
// MID, MICRO, DEEP VAMP). This is the domain knowledge that makes her app feel
// expert — a frontend dev without trading background wouldn't know to compute
// these. Each function below is her actual logic, de-minified and named.
//
// Convention: an order book side is an array of levels sorted best → worst:
//   bids = [{price, quantity}, ...]  (L1 = highest bid first)
//   asks = [{price, quantity}, ...]  (L1 = lowest ask first)
// Every function returns null on missing data (her code is defensive everywhere).
// ────────────────────────────────────────────────────────────────────────────

// MICROPRICE  — her `Lle(bestBid, bestAsk)`
// The classic size-weighted mid: each side's price is weighted by the OPPOSITE
// side's size. If bids are much larger than asks, the fair price sits closer to
// the ask (buyers are eager) — so it leads the plain mid. This is the single most
// useful "true price" estimate in market-making.
export function microprice(bestBid, bestAsk) {
  if (!bestBid || !bestAsk) return null;
  const size = bestBid.quantity + bestAsk.quantity;
  if (size <= 0) return null;
  return (bestBid.price * bestAsk.quantity + bestAsk.price * bestBid.quantity) / size;
}

// ANCHOR MID  — her `Ole(bids, asks, anchorGap)`
// Plain mid = (bestBid + bestAsk)/2, but a lone flickering L1 quote makes it
// noisy. This "anchors" to L2 instead of L1 on a side IF the L1→L2 gap is >= the
// `anchorGap` threshold (that's the ± stepper in her toolbar). It ignores thin
// top-of-book quotes and tracks where the real liquidity sits.
export function anchorMid(bids, asks, anchorGap) {
  const bidL1 = bids?.[0], bidL2 = bids?.[1];
  const askL1 = asks?.[0], askL2 = asks?.[1];
  if (!bidL1 || !askL1) return null;

  let bid = bidL1.price;
  let ask = askL1.price;
  if (bidL2 && bidL1.price - bidL2.price >= anchorGap) bid = bidL2.price;
  if (askL2 && askL2.price - askL1.price >= anchorGap) ask = askL2.price;
  return (bid + ask) / 2;
}

// WORST MID  — her `Dle(bids, asks)`
// Mid of the DEEPEST visible levels (last entry each side). Shows the outer edge
// of the book — useful for gauging how wide liquidity really stretches.
export function worstMid(bids, asks) {
  const worstBid = bids?.at(-1);
  const worstAsk = asks?.at(-1);
  if (!worstBid || !worstAsk) return null;
  return (worstBid.price + worstAsk.price) / 2;
}

// DEEP VAMP  — her `Ale(bids, asks)`  (Volume-Adjusted Mid Price across depth)
// Microprice generalized over the whole book: for each matched level pair, weight
// each side's price by the opposite side's size, then divide by total volume.
// A depth-aware fair value that uses every level, not just the top.
export function deepVamp(bids, asks) {
  const b = bids ?? [], a = asks ?? [];
  const levels = Math.min(b.length, a.length);
  if (levels === 0) return null;

  let weighted = 0, totalVolume = 0;
  for (let i = 0; i < levels; i++) {
    weighted += a[i].price * b[i].quantity + b[i].price * a[i].quantity;
    totalVolume += b[i].quantity + a[i].quantity;
  }
  return totalVolume <= 0 ? null : weighted / totalVolume;
}

// BOOK PRESSURE / IMBALANCE — the "bids heavy ↔ asks heavy" bar.
// Fraction of visible volume resting on the bid side. > 0.5 → buy pressure.
export function bookPressure(bids, asks) {
  const bidVol = (bids ?? []).reduce((s, l) => s + l.quantity, 0);
  const askVol = (asks ?? []).reduce((s, l) => s + l.quantity, 0);
  const total = bidVol + askVol;
  return total > 0 ? bidVol / total : 0.5;
}
