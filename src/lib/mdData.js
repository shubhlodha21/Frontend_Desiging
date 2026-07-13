// Synthetic MD-desk data, shaped like what the engine already logs:
// account rollup · per-strategy positions · cumulative day P&L · alerts.
// Designing this shape once (mirroring the /api/snapshot + audit feeds) is what
// keeps the screen components tiny. Swap generateMdData() for the live feed to
// go demo → real without touching the UI.

const UNIVERSE = [
  ["NVDA", "EQUITY", "LONG"],
  ["META", "EQUITY", "LONG"],
  ["MSFT", "EQUITY", "SHORT"],
  ["GOOGL", "EQUITY", "LONG"],
  ["EURUSD", "FX", "LONG"],
  ["USDCAD", "FX", "SHORT"],
  ["AUDUSD", "FX", "LONG"],
  ["IBUS500", "CFD", "SHORT"],
  ["IBDE40", "CFD", "LONG"],
  ["AMD", "CFD", "SHORT"],
  ["ORCL", "CFD", "LONG"],
  ["NFLX", "CFD", "SHORT"],
];
const OFF_STATES = ["MONITORING", "WAITING_REENTRY", "ORDER_ENTRY"];
const rnd = (a, b) => a + Math.random() * (b - a);

function priceFor(symbol, asset) {
  if (asset === "FX") return rnd(0.62, 1.42);
  if (asset === "CFD" && symbol.startsWith("IB")) return rnd(7000, 30000);
  return rnd(95, 620); // equity + single-stock CFD
}

export function generateMdData() {
  // cumulative intraday P&L path (the headline curve)
  let total = 0;
  const pnl_series = [];
  for (let i = 0; i < 130; i++) {
    total += rnd(-150, 205);
    pnl_series.push({ timestamp: i, total: Math.round(total) });
  }
  const dayPnl = pnl_series.at(-1).total;

  // desk-wide net position over time (step path) — the POSITION plot
  let netPos = 0;
  const position_series = pnl_series.map((p) => {
    if (Math.random() < 0.16) netPos += Math.round(rnd(-9, 9));
    return { timestamp: p.timestamp, pos: netPos };
  });

  const t0 = Date.now();
  const positions = UNIVERSE.map(([symbol, asset, strategy], i) => {
    const open = Math.random() > 0.34;
    const entry = priceFor(symbol, asset);
    const last = entry * (1 + rnd(-0.013, 0.016));
    const qty = asset === "FX" ? 25000 : asset === "CFD" && !symbol.startsWith("IB") ? 5 : asset === "CFD" ? 1 : 100;
    const dir = strategy === "LONG" ? 1 : -1;
    const notionalQty = asset === "FX" ? qty / 1000 : qty;
    const pnl = open ? Math.round(dir * (last - entry) * notionalQty) : 0;
    const dp = asset === "FX" ? 4 : 2;
    const slPct = +rnd(0.3, 0.55).toFixed(2);
    const offset = asset === "FX" ? 0.0005 : asset === "CFD" && symbol.startsWith("IB") ? 1.0 : 0.05;
    const bid = +(last * (1 - rnd(0.0002, 0.0009))).toFixed(dp);
    const ask = +(last * (1 + rnd(0.0002, 0.0009))).toFixed(dp);
    const high = +(entry * (1 + rnd(0.006, 0.02))).toFixed(dp);
    const low = +(entry * (1 - rnd(0.006, 0.02))).toFixed(dp);

    // intraday price path for the drill-in chart (walk that lands on `last`)
    const series = [];
    let sp = entry * (1 - dir * 0.006);
    for (let k = 0; k < 90; k++) { sp += sp * rnd(-0.0016, 0.0018); series.push({ t: k, price: +sp.toFixed(dp) }); }
    series[89].price = last;

    // trades sheet — entry fill then scale-outs, each with a commission
    const entrySide = strategy === "LONG" ? "BUY" : "SELL";
    const nF = 2 + (i % 4);
    const fills = [];
    let cComm = 0;
    for (let k = 0; k < nF; k++) {
      const commission = +rnd(0.6, 3.2).toFixed(2);
      cComm += commission;
      fills.push({
        x: Math.round(((k + 1) / (nF + 1)) * 88),
        ts: t0 - (nF - k) * Math.round(rnd(4, 12)) * 60000,
        event: "FILLED",
        side: k === 0 ? entrySide : entrySide === "BUY" ? "SELL" : "BUY",
        type: k === 0 ? "STP LMT" : k % 3 === 0 ? "MKT" : "STP",
        tif: k === 0 ? "DAY" : "GTC",
        qty: k === 0 ? qty : Math.max(1, Math.round(qty / Math.max(1, nF - 1))),
        price: +(entry * (1 + rnd(-0.008, 0.01))).toFixed(dp),
        slippageBp: +rnd(-1.2, 2.6).toFixed(1),
        commission,
        exchange: asset === "FX" ? "IDEALPRO" : asset === "CFD" ? "SMART" : ["NYSE", "NASDAQ", "ARCA"][k % 3],
        orderId: 30000 + i * 25 + k,
        pnl: k === 0 ? 0 : Math.round(rnd(-150, 260)),
      });
    }

    return {
      symbol, asset, strategy,
      qty: open ? qty : 0,
      entry: +entry.toFixed(dp),
      last: +last.toFixed(dp),
      bid, ask,
      spreadBps: +(((ask - bid) / last) * 10000).toFixed(1),
      high, low,
      vwap: +((high + low) / 2).toFixed(dp),
      volume: Math.round(rnd(2e5, 9e6)),
      buyPct: Math.round(rnd(38, 62)),
      stop: +(entry * (1 - dir * slPct / 100)).toFixed(dp),
      slPct,
      offset,
      pnl,
      realized: Math.round(rnd(-180, 520)),
      series, fills,
      totalCommission: +cComm.toFixed(2),
      avgCommission: +(cComm / nF).toFixed(2),
      tradeCount: nF,
      state: open ? "IN_POSITION" : OFF_STATES[i % OFF_STATES.length],
      cycle: 1 + (i % 5),
    };
  });

  const wins = Math.round(rnd(19, 33));
  const losses = Math.round(rnd(6, 15));
  const exposure = Math.round(
    positions.filter((p) => p.qty).reduce((a, p) => a + Math.abs(p.last * (p.asset === "FX" ? p.qty / 1000 : p.qty)), 0),
  );
  const openCount = positions.filter((p) => p.qty).length;

  const account = {
    equity: 1_002_000 + dayPnl,
    dayPnl,
    dayPnlPct: (dayPnl / 1_000_000) * 100,
    exposure,
    bpUsedPct: rnd(7, 41),
    winRate: Math.round((wins / (wins + losses)) * 100),
    wins, losses,
    open: openCount,
    bots: positions.length,
  };

  const alerts = [
    { sev: "MEDIUM", code: "REENTRY_ARMED", symbol: "IBUS500", msg: "Re-entry armed at prior breakdown low", ago: "2m" },
    { sev: "LOW", code: "STOP_TRAILED", symbol: "NVDA", msg: "Protective stop trailed to 194.20", ago: "6m" },
    { sev: "HIGH", code: "SLIPPAGE_HIGH", symbol: "AMD", msg: "Fill slippage 3.2bp over budget", ago: "11m" },
    { sev: "LOW", code: "SESSION_OPEN", symbol: "—", msg: "US equity RTH session open", ago: "1h" },
  ];

  return { account, pnl_series, position_series, positions, alerts };
}
