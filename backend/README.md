# GT Desk Backend — FastAPI

The launch-approval service for the MD desk. The MD submits a strategy from the
order ticket; it sits **pending** until an admin approves it; only then does the
engine open a position.

Built to match the contract the React frontend already expected — no frontend
changes were needed to the data layer.

## Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Port **8000** is not arbitrary — `vite.config.js` proxies `/api` and `/ws` there,
so the frontend reaches it same-origin in dev with no CORS. Interactive API docs:
<http://127.0.0.1:8000/docs>.

Run the frontend (`npm run dev`) in a second terminal. With both up, the app
switches from `demo` to `live`.

## Hosting — one service

`vite.config.js`'s `/api` proxy exists **only under `npm run dev`**. A production
build is static files with no proxy, so a frontend-only deploy (Netlify, Vercel,
S3) leaves every `/api` call 404ing — the Deploy button submits into the void and
the admin queue stays empty forever.

The fix is to serve the built frontend *from here*, so everything is same-origin:

```powershell
npm run build      # from the project root → dist/
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Now **`http://127.0.0.1:8000`** serves the whole app — no Vite process at all:

| URL | |
|---|---|
| `:8000/` | MD desk |
| `:8000/?admin=1` | Admin approval queue |
| `:8000/docs` | API docs |

`main.py` mounts `dist/` at `/` **last**, so registered routes (`/api/*`, `/ws`)
still win and only unmatched paths fall through to the built assets. Query-string
routing (`?admin=1`) means no SPA path fallback is needed.

Rebuild (`npm run build`) after any frontend change — uvicorn serves whatever is
in `dist/`, and `--reload` does not watch it.

### Deploying split (frontend and backend on different hosts)

Doesn't work as-is. `liveFeed.js` uses **relative** paths (`/api/snapshot`), so
the browser would call the *frontend's* domain and 404. You'd need a configurable
API base URL plus CORS entries for the frontend's origin. Single-service is
simpler and is what the code assumes.

## Staging to tmux (EC2)

On approval the backend allocates a client-id, builds the `run_live.py` command,
opens a tmux window in the side's directory, and **types the command without
pressing Enter**. A human reviews it and hits Enter. Nothing here executes a
trade.

```
approve → allocate client-id → build command → tmux new-window → send-keys
                                                                 (no Enter)
```

The missing `Enter` is the entire safety model. `staging.py` never sends it.

### Modes — `GT_STAGING`

| Value | Behaviour |
|---|---|
| `off` *(default)* | Nothing built, no ids consumed. Dev default. |
| `dry` | Command built + stored in the DB, **tmux untouched**. Test with this. |
| `on` | Window opened, command staged, waiting on Enter. |

Default is `off` on purpose: there's no tmux on a dev box, and a bug that
silently stages live-money commands is worse than one that does nothing.

### Config

| Env | Default | |
|---|---|---|
| `GT_STAGING` | `off` | `off` \| `dry` \| `on` |
| `GT_LONG_DIR` | `/srv/gt/long` | where `run_live.py` lives for LONG |
| `GT_SHORT_DIR` | `/srv/gt/short` | same for SHORT |
| `GT_TMUX_SESSION` | `gt` | session holding staged windows |
| `GT_IB_PORT_LIVE` | `7496` | used when `paper=false` |
| `GT_IB_PORT_PAPER` | `7497` | used when `paper=true` |
| `GT_LONG_CID_MIN/MAX` | `1` / `100` | LONG client-id range |
| `GT_SHORT_CID_MIN/MAX` | `101` / `200` | SHORT client-id range |
| `GT_PYTHON_BIN` | `python3` | |
| `GT_EXTRA_FLAGS` | `--uvloop` | appended before `--qty` |

### Rollout on the EC2

```bash
# 1. dry first — inspect what it WOULD run, without touching tmux
GT_STAGING=dry GT_LONG_DIR=/srv/gt/long GT_SHORT_DIR=/srv/gt/short \
  uvicorn app.main:app --port 8000

# approve something, then read back the exact command:
curl -s localhost:8000/api/launch-intents | jq -r '.[0].staged_command'

# 2. only when that line is right, turn it on
GT_STAGING=on ... uvicorn app.main:app --port 8000
tmux attach -t gt        # the command is typed, waiting on Enter
```

### Client-ids

IBKR refuses a second connection on an id already in use, so ids are allocated
from the DB, not guessed: LONG `1-100`, SHORT `101-200`, lowest free first.

```
GET  /api/launch-intents/-/client-ids     what's held right now
POST /api/launch-intents/{id}/release     hand one back
```

**Ids are held until released, and the backend cannot see `run_live.py` exit** —
so release is manual. Skip it and the range fills up until approvals fail with
`NoClientIdAvailable`. Only release once the process is actually dead; releasing
one a live strategy still holds means the next approval collides with it.

### Schema changes

`create_all()` only creates missing *tables* — it will not add columns to an
existing one, and there's no Alembic yet. After a model change, either delete
`gt_desk.db` (loses the audit trail) or `ALTER TABLE ... ADD COLUMN` by hand.

### Before it's publicly reachable

- **Add auth.** There is none — anyone with the URL can approve an order.
- Drop `--reload`, and put it behind HTTPS (the frontend auto-selects `wss://`).
- Tighten `allow_origins` in `main.py`; same-origin hosting needs no CORS at all.

## The flow

```
MD fills ticket → POST /api/launch-intents → PENDING_APPROVAL   (persisted)
                                                   ↓
                                       admin approves / rejects
                                                   ↓
                        APPROVED → engine adopts (~1s) → LAUNCHED → /api/snapshot
                        REJECTED → terminal, never reaches the engine
```

Deploy **files an intent, it does not place an order**. That separation is the
whole point of the service.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/launch-intents` | MD submits (→ `PENDING_APPROVAL`) |
| `GET` | `/api/launch-intents` | Queue, newest first. `?pending_only=true` |
| `GET` | `/api/launch-intents/{id}` | One intent |
| `POST` | `/api/launch-intents/{id}/approve` | Desk approves (→ `APPROVED`) |
| `POST` | `/api/launch-intents/{id}/reject` | Desk rejects, optional `{"reason": "..."}` |
| `GET` | `/api/snapshot` | Live positions, polled every 1.5s |
| `GET` | `/api/health` | Liveness + open position count |
| `WS` | `/ws` | Push nudge on every state change |

Decisions are **one-shot**: approving or rejecting an already-decided intent
returns **409**. Without that, re-approving a `LAUNCHED` intent would re-open a
position the engine already holds.

## Layout

```
app/
  main.py       FastAPI app, CORS, engine loop (1s tick)
  models.py     LaunchIntent — the SQLModel table / audit trail
  schemas.py    Request/response shapes (the frontend contract)
  db.py         SQLite engine + session
  hub.py        WebSocket fan-out
  engine.py     STUB execution engine — replace with run_live.py / IBKR
  routers/
    intents.py  the approval queue
    snapshot.py positions feed
    ws.py       websocket endpoint
gt_desk.db      SQLite (gitignored, created on first run)
```

## Contract gotchas

Three things the frontend is strict about. All are handled, but they'll bite if
you refactor:

1. **Status strings are exact.** `PENDING_APPROVAL` → "PENDING";
   `APPROVED`/`LAUNCHED` → "APPROVED"; **anything else → "REJECTED"**. A typo'd
   status silently renders as a rejection rather than an error.
2. **Timestamps must carry a UTC offset.** SQLite has no timezone type, so
   tz-aware values come back naive. Emitted bare, `Date.parse()` reads them as
   *local* time — in Dubai (UTC+4) a fresh decision looks 4h old and falls
   outside the frontend's 8s "recently decided" window, so approvals never
   surface. A `field_serializer` in `schemas.py` forces the offset back on.
3. **`[]` from `/api/snapshot` means "up, no bots"** (`live-empty`), not an
   error. The frontend only falls back to demo data when the request *fails*.

## Not done yet

- **Auth.** There is none. `approve`/`reject` take an `admin` placeholder —
  anyone who can reach this port can approve an order. JWT with `md`/`admin`
  roles is the next step, before anything else.
- **Admin UI.** No screen renders the queue. Approve via `/docs` or curl for
  now; a `?admin=1` React screen reusing the existing `Card`/`Chip` primitives
  is the cheapest path.
- **The engine is a stub.** `engine.py` random-walks synthetic prices. Replace
  `_tick()` with real market data and `adopt_approved()` with real IBKR order
  placement — the API contract above it doesn't change.
- **Risk checks.** `POST` validates shape only (qty ≥ 1, trigger > 0,
  stop ≤ 0.99). No buying-power, position-limit, or duplicate-symbol checks.
- **Postgres.** SQLite is fine for one machine. Swap `DATABASE_URL` in `db.py`.

## Quick test

```powershell
# submit
curl.exe -s -X POST http://127.0.0.1:8000/api/launch-intents `
  -H "content-type: application/json" `
  -d '{\"symbol\":\"NVDA\",\"side\":\"LONG\",\"asset\":\"EQUITY\",\"qty\":100,\"trigger\":195.5,\"stop\":0.05,\"paper\":true}'

# see the queue
curl.exe -s "http://127.0.0.1:8000/api/launch-intents?pending_only=true"

# approve (paste the id), then watch it appear as a position
curl.exe -s -X POST http://127.0.0.1:8000/api/launch-intents/<id>/approve
curl.exe -s http://127.0.0.1:8000/api/snapshot
```
