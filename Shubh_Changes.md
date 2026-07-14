# Shubh_Changes — Code & Development Notes

Full scan of the `Frontend_Desiging` project. Covers how to run it, what it depends
on, how the code is structured, what was changed, and what's still outstanding.

- **Project:** `prosperity-study` v0.0.1 (private)
- **Branch:** `shubh`
- **Scanned:** 14 Jul 2026
- **Frontend:** React 18 + Vite 5 + Tailwind v4 + Recharts
- **Backend:** FastAPI + SQLModel + SQLite (added 14 Jul 2026 — see `backend/README.md`)

---

## 1. Environment & Setup

### Installed this session

Node.js was **not installed** on this machine — that was the only thing blocking the
app from running. Everything else was already declared and installed.

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.18.0 | Installed via `winget install OpenJS.NodeJS.LTS` |
| npm | 11.16.0 | Bundled with Node. (npm 12.0.1 available, not required) |

**Requirement:** Vite 5.4 sets the floor at Node `^18.0.0 || >=20.0.0`. Node 24 LTS
satisfies every package in the tree.

### PATH gotcha (Windows)

After installing Node, **already-open terminals keep failing with
`npm : The term 'npm' is not recognized`**. Windows hands each process its
environment at launch, so the installer's PATH update can't reach backward into
windows that are already open.

- **Fix:** close the terminal and open a new one. Permanent.
- **One-time patch** for an existing window (PowerShell):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

### Running it

```powershell
npm install
npm run dev      # http://localhost:5173
```

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server, HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built `dist/` |

> Shell note: this project's docs use Unix examples. In PowerShell, `printf`, `cat`,
> `rm -rf` etc. don't exist — use `Set-Content`, `Get-Content`, `Remove-Item -Recurse -Force`.

---

## 2. Dependencies

All declared in `package.json`; `npm install` handles everything. Nothing needs
manual installation.

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `react` / `react-dom` | 18.3.1 | UI |
| `recharts` | 2.15.4 | All charts |
| `sileo` | 0.1.5 | Physics-based toast notifications |

### Dev

| Package | Version | Purpose |
|---|---|---|
| `vite` | 5.4.21 | Dev server + bundler |
| `@vitejs/plugin-react` | 4.7.0 | JSX / Fast Refresh |
| `tailwindcss` | 4.3.2 | Styling |
| `@tailwindcss/vite` | 4.3.2 | Tailwind v4 Vite plugin |

### Notes on `sileo`

Not mentioned in the README, so it was verified: it's a **legitimate** npm package
(MIT, real repo at `github.com/hiaaryan/sileo`, resolved from the registry with a
valid integrity hash), and its exports match the code's usage. It pulls in `motion`
as a transitive dependency. Used only in `MdScreen.jsx` via a defensive `notify()`
wrapper that falls back to `sileo.success` if a variant is missing.

### Native binaries / cross-platform

`node_modules` was originally synced from a **Mac** (evidence: `.DS_Store`, a
Syncthing temp file, and `darwin-arm64` binaries). It now contains **both**
`darwin-arm64` and `win32-x64` builds of esbuild, rollup, and Tailwind's oxide.
`npm install` reconciled it (removed 5, changed 7 packages) and it works on Windows.

If you ever hit a "binary for another platform" error, delete `node_modules` and
reinstall.

> npm 11 warns that **esbuild's postinstall script was blocked** (`allow-scripts`).
> This is harmless here — the Windows binaries were already in place and esbuild
> works (verified: JSX transforms correctly).

---

## 3. Architecture

### File map

```
index.html            → mounts #root, loads Google Fonts (Inter + JetBrains Mono)
vite.config.js        → React + Tailwind plugins, /api + /ws proxy to :8000
src/
  main.jsx            → entry; picks which screen to render from the URL
  MdScreen.jsx        → 1527 lines. The MD desk cockpit + 3 mobile variants
  App.jsx             → the "study" dashboard (playback demo)
  index.css           → Tailwind v4 @theme design tokens
  components/
    Charts.jsx        → PriceChart + PnlChart (syncId, Brush, custom tooltip)
    OrderBook.jsx     → order-book ladder, depth bars, pressure gauge
    Transport.jsx     → play/pause/speed/scrubber (stateless)
    ui.jsx            → Card, Money, Chip, ChipGroup, Stat, Label
  lib/
    mdData.js         → synthetic MD-desk data generator
    parseLog.js       → ';'-delimited log parser + demo generator
    usePlayback.js    → rAF playback engine (owns currentTick)
    metrics.js        → microprice, anchorMid, worstMid, deepVamp, bookPressure
    liveFeed.js       → backend adapter (poll /api/snapshot + /ws)
```

### Screen routing (`main.jsx`)

Routing is by **query string**, not React Router:

| URL | Screen |
|---|---|
| `/` (desktop) | `MdScreen` — full cockpit |
| `/` (width ≤ 767px) | `MdMobile` — auto |
| `?admin=1` | `AdminScreen` — desk approval queue |
| `?study=1` | `App` — the playback study dashboard |
| `?mobile=1` \| `2` \| `3` | `MdMobile` / `MdMobileFocus` / `MdMobileCommand` |
| `?desktop` | Forces the cockpit on a phone |

An error boundary (`EB`) wraps the screen and renders the stack trace inline.

### Data flow — important detail

The two screens get their data **differently**:

- **`MdScreen` (desktop)** — `useState(() => generateMdData())`. Static demo data.
  **Does not poll the backend.** "Regenerate" re-rolls it.
- **`MdMobile` (line 976)** — `useMdData()`. **Polls `/api/snapshot` every 1.5s**
  plus a `/ws` socket, falling back to demo data when the backend is down.

> This means `/api/snapshot` proxy errors in the Vite log indicate a **mobile**
> screen is rendering (narrow window or `?mobile=`), not the desktop cockpit.

### Backend is optional

`vite.config.js` proxies `/api` and `/ws` → `http://127.0.0.1:8000` (FastAPI).
Override with the `GT_API_TARGET` env var.

**You do not need the backend.** `liveFeed.js` swallows the connection error and
keeps showing synthetic data:

```js
} catch {
  /* backend unreachable → stay on whatever we have (demo) */
}
```

`ECONNREFUSED 127.0.0.1:8000` in the log is **expected and harmless** — it's Vite
reporting a failure the app has already handled. It repeats every 1.5s and stops
once a backend appears. Modes: `demo` → `live` → `live-empty`.

### Key techniques in the code

1. **Tailwind v4 configured in CSS** — no `tailwind.config.js`, no `postcss.config`.
   Tokens live in `src/index.css` under `@theme` (`--color-up`, `--color-down`).
   Changing those two re-themes every gain/loss number in the app.
2. **Recharts `syncId="prosperity"`** — every chart sharing the id shares a hover
   crosshair. One prop; it's what makes separate panels feel like one instrument.
3. **`usePlayback` owns one number** (`currentTick`) via requestAnimationFrame.
   Refs let the loop read latest values without restarting. Everything else derives.
4. **Parse by fixed column index** — `parseLog.js` splits on `;` and reads known
   positions. No CSV library; the file never leaves the browser.
5. **Shared primitives** — `Card`/`Money`/`Stat`/`Chip` keep every panel coherent.
6. **Zinc palette + JetBrains Mono with `tabular-nums`** so numbers don't jitter.

> Documented gotcha in `Charts.jsx`: Recharts categorises children by component
> **type**, so wrapping `<ReferenceLine>` in your own component makes Recharts
> silently drop it. It's rendered directly inside each chart.

---

## 4. Changes Made

### Committed — `b704de3` "Add .gitignore; stop tracking node_modules, dist, .DS_Store"

**Problem:** the repo had **no `.gitignore`**, and `node_modules` (6,214 files),
`dist` (3 files), and `.DS_Store` were all committed. Every `npm install` produced
a huge diff that buried real work.

**Fix:** added `.gitignore` and ran `git rm -r --cached` on those paths.

- Tracked files: **6,238 → 20** (source only)
- **Nothing deleted from disk** — `--cached` only touches git's index
- The dev server was unaffected

`.gitignore` covers: `node_modules/`, `dist/`, `.vite/`, `.DS_Store`, `Thumbs.db`,
`.syncthing.*.tmp`, `.env`, `.env.local`, `.code-review-graph/`.

> `git rm` printed `fatal: pathspec 'node_modules' did not match any files` but
> **had staged the removals correctly**. The exit code was misleading; the result
> was verified directly.

---

## 4b. Backend — FastAPI (added 14 Jul 2026)

Full detail in **`backend/README.md`**. Summary:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Python **3.14.4**. All deps resolved cleanly (FastAPI 0.139, SQLModel 0.0.39,
Pydantic 2.13, SQLAlchemy 2.0.51) — cp314 wheels exist, no pinning needed.

**The flow:** MD fills the ticket → `POST /api/launch-intents` → `PENDING_APPROVAL`
→ admin approves at `?admin=1` → engine adopts within ~1s → `LAUNCHED` → appears
in `/api/snapshot`. Reject is terminal; the engine never sees it.

Deploy **files an intent, it does not place an order.**

### Frontend changes made to support it

- **`AdminScreen.jsx`** (new) — approval queue at `?admin=1`. Poll every 3s +
  WebSocket for instant updates. Handles 409 (someone else decided first).
- **`MdScreen.jsx`** — the desktop Deploy button previously called
  `onPlaced?.()` with **no handler attached**, so it fired a toast and submitted
  nothing. Now wired with `onPlaced` + `approval`, plus an approval poller and
  the `PendingApproval` card.
- **`liveFeed.js`** — added `approveIntent()`, `rejectIntent()`;
  `fetchIntents()` takes `{pendingOnly}`.
- **`main.jsx`** — `?admin=1` route, checked before the phone-width rule so it
  works on mobile.

### Two bugs found while testing

1. **Naive timestamps.** SQLite has no timezone type, so tz-aware values came
   back naive. `Date.parse()` reads an offset-less string as *local* time — in
   Dubai (UTC+4) every decision would look 4h old and fall outside the
   frontend's 8s window, so **approvals would silently never appear**. Fixed
   with a `field_serializer` in `schemas.py`.
2. **`PendingApproval` called `fmtWait(o.id)`**, treating the id as a
   timestamp. Fine in demo mode (`id = String(Date.now())`), but the backend
   returns UUIDs → `NaN:NaN`. Now uses a proper `at` field; `fmtWait` guards
   non-finite input.

### Verified end-to-end

Submit → pending → approve → LAUNCHED → live position. Reject stays out of the
engine. Double-decide returns 409. Bad input returns 422. WebSocket pushes
`intent.submitted` / `approved` / `launched` through the Vite proxy.

---

## 5. Open Items

### No auth on the backend — highest priority

`approve`/`reject` take an `admin` string placeholder. **Anyone who can reach
:8000 can approve an order.** JWT with `md`/`admin` roles is the next build.
Until then, don't expose the port beyond localhost.

### Desktop Positions table still shows demo data

`MdScreen.jsx:93` uses `generateMdData()`, not `useMdData()`. The approval flow
works on desktop, but an approved position appears only on the **mobile** screen
and in `/api/snapshot` — not in the desktop Positions table. Switching it would
break the "Regenerate demo" button, so it's a deliberate open decision.

### The engine is a stub

`backend/app/engine.py` random-walks synthetic prices. Replace `_tick()` with
real market data and `adopt_approved()` with real IBKR order placement — the
API contract above it doesn't change. No risk checks exist (no buying-power,
position-limit, or duplicate-symbol validation).

### `src/.syncthing.MdScreen.jsx.tmp` is still tracked (1188 lines)

A Syncthing temp artifact that got committed. Its contents **differ** from the real
`MdScreen.jsx` (1527 lines) — a stale snapshot from an earlier mid-sync state.

The `.gitignore` pattern covers future files, but this one is already tracked so the
rule won't touch it. **Left in place deliberately** — worth diffing against
`MdScreen.jsx` before deleting, in case it holds work that never landed.

```powershell
git rm --cached "src/.syncthing.MdScreen.jsx.tmp"   # untrack, keep on disk
```

### npm audit: 2 vulnerabilities (1 moderate, 1 high)

| Package | Severity | Note |
|---|---|---|
| `esbuild` | moderate | Root advisory |
| `vite` | high | Inherited via `esbuild` |

Both are **dev-only** (dev server, no untrusted input) and don't affect production
output. `npm audit fix --force` offers a **breaking** Vite upgrade — not recommended
against a working setup. Revisit as a deliberate upgrade.

### Project lives inside OneDrive

The repo sits under `OneDrive - Gautam General Trading LLC/`, so `node_modules` is
being sync-churned. Combined with `.DS_Store` and the Syncthing temp file, this
folder is synced by **two** tools from a Mac.

OneDrive file-locking during `npm install` is a classic source of `EPERM`/`EBUSY`
errors on Windows. Nothing has broken yet, but if installs act strange, move the
repo to something like `C:\dev\`.

### Dev-tooling config files are untracked

`.claude/`, `.cursorrules`, `.kiro/`, `.mcp.json`, `.opencode.json`,
`.windsurfrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` are present but untracked.
Decide whether to commit or ignore them.

### From the README — possible next steps

- Order-book depth panel (the parser already captures `bids`/`asks` per tick)
- Trades scatter overlay on the price chart
- Redux Toolkit + React Router once more than 2 views share state
- Code-split with dynamic `import()` (the build already warns about bundle size)

---

## 6. Quick Reference

```powershell
npm run dev                  # dev server → :5173
npm run build                # production build
npm run preview              # serve the build

$env:GT_API_TARGET = "http://127.0.0.1:8000"   # override backend target
```

| Symptom | Cause | Fix |
|---|---|---|
| `npm not recognized` | Terminal opened before Node install | New terminal |
| Server on **5174** not 5173 | 5173 already in use | Stop the other server |
| `ECONNREFUSED :8000` spam | Backend not running | Expected — app uses demo data |
| `printf not recognized` | Unix command in PowerShell | Use `Set-Content` |
| Huge `git status` after install | *(fixed in `b704de3`)* | — |
