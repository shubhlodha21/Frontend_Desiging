# Prosperity Study — learn how the Visualizer frontend was built

A small, **clean-code** reconstruction of the core techniques behind
[prosperity.equirag.com](https://prosperity.equirag.com/), built so you can *read* and
*learn* the patterns (the real site ships only a 1.5 MB minified bundle with no source maps).

```sh
cd prosperity_study
npm install
npm run dev      # http://localhost:5173
```

Loads with synthetic demo data. Click **Upload log** to feed it a `;`-delimited log file.

## The 5 techniques worth studying

Each is small on its own — the *quality* comes from doing all five consistently.

### 1. Tailwind v4, configured in CSS (not JS)
- `vite.config.js` uses `@tailwindcss/vite` — no `postcss.config`, no `tailwind.config.js`.
- The design system lives in `src/index.css` inside `@theme { … }` (fonts, accent tokens).
- **Learn:** open `src/index.css`. Changing `--color-up`/`--color-down` re-themes every gain/loss number in the app.

### 2. A restrained zinc palette + a mono font for data
- Backgrounds/borders/text are all `zinc-*`. The only saturated colors are the *data* (chart lines, PnL green/red).
- All numbers use **JetBrains Mono** with `tabular-nums` (`.font-mono` in `index.css`) so they don't jitter as they update.
- **Learn:** this is the #1 reason it reads as "professional." Color is information, not decoration.

### 3. Synchronized charts via Recharts `syncId`  ← the signature move
- In `src/components/Charts.jsx`, both charts pass the same `syncId="prosperity"`.
- Result: hovering the price chart moves the crosshair on the PnL chart to the same timestamp.
- The original does this across **6 charts**. It's one prop, and it's what makes separate panels feel like one instrument.
- Also here: `<Brush>` for drag-to-zoom, a custom dark tooltip, muted axis chrome, animation disabled for snappy hover.

### 4. Parse data in the browser, by fixed column index
- `src/lib/parseLog.js` splits each line on `;` and reads known column positions — no CSV library, very fast, and the file never leaves the browser.
- It also ships a **synthetic data generator** so the dashboard is never empty on load (the real app has a demo mode too).
- **Learn:** note the data *shape* it produces (`timeline` + `pnl_series`). Designing that shape once, up front, is what keeps the chart components tiny.

### 5. Consistent "card" chrome + derived values
- `src/components/ui.jsx` has `Card`, `Money`, `Stat` — every panel is the same white surface + hairline border + soft rounding.
- `App.jsx` derives summary stats with `useMemo` and keeps all data in one `useState` object.
- **Learn:** a handful of reused primitives >> bespoke styling per section. This is how one person keeps a whole app visually coherent.

## How this maps to the real bundle

| Real app | Here |
|---|---|
| Tailwind v4 (`@layer theme/base/components/utilities`) | `index.css` `@theme` |
| Zinc palette + JetBrains Mono | `index.css` |
| Recharts `ComposedChart`/`LineChart`/`Brush`/synced `Tooltip` | `Charts.jsx` |
| `syncId` across 6 charts | `syncId="prosperity"` |
| Hand-rolled `;`-delimited log parsers (legacy/day-replay/submission) + demo generator | `parseLog.js` |
| Redux Toolkit + React Router | *(omitted — one `useState` is enough to learn the rest; add them when your app grows)* |
| PostHog + Sentry telemetry | *(omitted intentionally)* |

## Where to go next (to match the original more closely)
- Add an **order-book depth** panel (the parser already captures `bids`/`asks` per tick).
- Add a **trades scatter** overlay on the price chart (`ScatterChart`, as in the original).
- Introduce **Redux Toolkit** once you have >2 views sharing state, and **React Router** for multiple pages.
- Split the bundle with dynamic `import()` (the build already warns about size).
