# test_check — manual test walkthrough

Step-by-step check of the whole system: Docker → submit → approve → tmux → database.

Run everything from the **project root**:
`C:\Users\shubham\OneDrive - Gautam General Trading LLC\Desktop\Frontend\Frontend_Desiging`
(VS Code: `Ctrl+\`` opens a terminal there already.)

---

## Step 0 — Stop the native server ⚠️

Find the terminal running `uvicorn` and press **Ctrl+C**.

**Not optional.** Windows lets the native server (`127.0.0.1:8000`) and the container
(`:::8000`) both bind port 8000. Leave both up and you'll test the wrong one and get
results that make no sense — the API answers, but from a server with different settings.

---

## Step 1 — Is the container up?

```powershell
docker compose ps
```

Expect: `frontend_desiging-api-1 ... running ... 0.0.0.0:8000->8000/tcp`

If not running:
```powershell
docker compose up -d
```

---

## Step 2 — Does only the container answer?

```powershell
curl.exe -s http://localhost:8000/api/health
```

Expect: `{"ok":true,"positions":0}`

Confirm it's in staging mode:
```powershell
docker compose exec api sh -c "echo $GT_STAGING"
```
Expect: `on`

---

## Step 3 — Open both screens

| Tab | URL | Role |
|---|---|---|
| 1 | <http://localhost:8000> | MD desk — submits |
| 2 | <http://localhost:8000/?admin=1> | Admin — approves |

Tab 2 should show **LIVE** in green. Side by side is best.

---

## Step 4 — Watch tmux live

Second terminal, same folder:

```powershell
docker compose exec api tmux attach -t gt
```

If it says *"no server running"* the session died with a container restart (expected —
tmux lives inside the container). Create it:

```powershell
docker compose exec api tmux new-session -d -s gt
docker compose exec api tmux attach -t gt
```

Leave it attached.
**To exit: `Ctrl+B`, release, then `D`.** (Never `Ctrl+C` — that kills things.)

---

## Step 5 — Submit an order (Tab 1)

Order ticket, right-hand column:

1. **TRIGGER: change `0` → `195.50`** ⚠️ it refuses to submit with `0`
2. Leave the rest (Long Breakout · Equity · NVDA · 100 units)
3. Click **DEPLOY LONG BREAKOUT · NVDA**

**Expect:** toast *"Submitted · NVDA"*, then an amber **"Awaiting Desk Approval"** card
with a ticking timer.

**If you see *"Set a trigger price before submitting"*** — trigger is still 0.

---

## Step 6 — It arrives at the desk (Tab 2)

Within ~3s NVDA appears at the top; badge reads **"1 waiting"**. No refresh needed
(WebSocket push + 3s poll).

Ground truth that it left the browser:
```powershell
docker compose logs --tail 5 api
```
Look for `POST /api/launch-intents ... 201 Created`.

---

## Step 7 — Approve it

Click **APPROVE** in Tab 2.

**Watch the tmux terminal** — a new window appears, e.g. `NVDA-2`:

```
root@...:/srv/gt/long# GT_PAPER=true python3 run_live.py NVDA --trigger 195.5 --port 7497 --client-id 2 --stop 0.05 --uvloop --qty 100
```

**Typed, not executed** — waiting on a human Enter. That is the entire safety model.

`GT_PAPER=true` / `--port 7497` because the UI submits `paper: true`.
Live would be `GT_PAPER=false` / `--port 7496`.

Detach: `Ctrl+B` then `D`.

Prove it really hasn't run:
```powershell
docker compose exec api tmux display-message -p -t gt:NVDA-2 "#{pane_current_command}"
```
Expect `bash` — i.e. still sitting at the prompt.

---

## Step 8 — Verify in the database

```powershell
docker compose exec api sqlite3 /data/gt_desk.db -box "SELECT symbol,status,client_id,staged_window,staging_error FROM launch_intents ORDER BY created_at DESC LIMIT 3;"
```

Expect your NVDA row: `LAUNCHED`, a `client_id`, a `staged_window`, and
`staging_error` **empty**. Text in `staging_error` means staging failed — it says why.

The exact command that was staged (your audit record):
```powershell
docker compose exec api sqlite3 /data/gt_desk.db -line "SELECT symbol,staged_command FROM launch_intents ORDER BY created_at DESC LIMIT 1;"
```

---

## Step 9 — Test reject

Submit another from Tab 1 (e.g. `TSLA`, trigger `248.90`).
In Tab 2: **REJECT** → type a reason → **Enter**.

**Expect:** red row in Recent Decisions with your reason in quotes, **no tmux window**,
**no client-id consumed**.

```powershell
docker compose exec api sqlite3 /data/gt_desk.db -box "SELECT symbol,status,client_id,reject_reason FROM launch_intents WHERE status='REJECTED';"
```

`client_id` must be **empty** — rejected orders never reach the engine.

---

## Step 10 — Client-id pool

```powershell
curl.exe -s http://localhost:8000/api/launch-intents/-/client-ids
```

Expect: `{"ranges":{"LONG":[1,100],"SHORT":[101,200]},"in_use":{"LONG":[1,2],"SHORT":[101]}}`

Now submit a **SHORT** (pick "Short Breakout" in the strategy dropdown) and approve it.
Its id should be **102**, not 3 — the ranges are independent. Its tmux window should
open in `/srv/gt/short`, not `/srv/gt/long`:

```powershell
docker compose exec api tmux display-message -p -t gt:<SYMBOL>-102 "#{pane_current_path}"
```

---

## Step 11 — Release a client-id

```powershell
# find one
docker compose exec api sqlite3 /data/gt_desk.db "SELECT id FROM launch_intents WHERE client_id=1;"

# release it (paste the id)
curl.exe -s -X POST "http://localhost:8000/api/launch-intents/<id>/release"

curl.exe -s http://localhost:8000/api/launch-intents/-/client-ids
```

`1` leaves `in_use`, and the next LONG approval reclaims it.

**Real world:** only release once `run_live.py` is genuinely dead. The backend can't see
it exit — release one a live strategy still holds and the next approval collides with it
on IBKR. See PENDING item 9.

---

## Step 12 — Injection is blocked

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:8000/api/launch-intents -H "content-type: application/json" -d "{\"symbol\":\"AAPL; rm -rf /\",\"side\":\"LONG\",\"asset\":\"EQUITY\",\"qty\":1,\"trigger\":10,\"stop\":0.05}"
```
Expect **422**.

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:8000/api/launch-intents -H "content-type: application/json" -d "{\"symbol\":\"BRK.B\",\"side\":\"LONG\",\"asset\":\"EQUITY\",\"qty\":1,\"trigger\":10,\"stop\":0.05}"
```
Expect **201** — real tickers with dots still work.

---

## Where the database actually is

Decided in one place — `backend/app/config.py:51`:

```python
DB_PATH = Path(os.getenv("GT_DB_PATH", str(Path(__file__).resolve().parents[1] / "gt_desk.db")))
```

*Use `GT_DB_PATH` if set, else default to `backend/gt_desk.db`.*
Used by `backend/app/db.py:18-24` to build the SQLite connection.

**Hence two databases:**

| Which | Set by | Location |
|---|---|---|
| Native (Windows) | nothing — the default | `backend/gt_desk.db` (a real file) |
| Container | `compose.yml:20`, `Dockerfile:36` | `/data/gt_desk.db` → volume `frontend_desiging_gt-data` |

The container's is on a **named volume**, not your C: drive — survives rebuilds, invisible
in Explorer. Pull a copy out:

```powershell
docker compose cp api:/data/gt_desk.db ./db-snapshot.db
```

Open that copy in [DB Browser for SQLite](https://sqlitebrowser.org/) if you prefer a GUI.
It's a snapshot — edits don't affect the running app.

---

## Cheat sheet

```powershell
docker compose ps                 # running?
docker compose logs -f api        # watch requests (Ctrl+C to stop watching)
docker compose restart api        # after editing backend/app/*.py
docker compose down               # stop (database survives)
docker compose up -d              # start
docker compose down -v            # stop AND WIPE the database

docker compose exec api tmux attach -t gt          # Ctrl+B then D to detach
docker compose exec api tmux list-windows -t gt
docker compose exec api sqlite3 /data/gt_desk.db   # SQL shell (.mode box, .quit)
```

| Changed | Do |
|---|---|
| `backend/app/*.py` | `docker compose restart api` (bind-mounted, no rebuild) |
| `src/*.jsx` | `npm run build`, refresh browser |
| `requirements.txt` / `Dockerfile` | `docker compose build` |

## Handy SQL

```sql
.mode box
SELECT symbol,side,qty,status,client_id FROM launch_intents ORDER BY created_at DESC;
SELECT symbol,staged_command FROM launch_intents WHERE staged_command IS NOT NULL;
SELECT symbol,staging_error FROM launch_intents WHERE staging_error IS NOT NULL;
SELECT side,client_id,symbol FROM launch_intents WHERE client_id IS NOT NULL AND client_id_released=0;
SELECT symbol,status,decided_by,decided_at,reject_reason FROM launch_intents WHERE decided_at IS NOT NULL;
```

Read-only is safest — the app has the file open, and editing a `client_id` by hand while
a strategy holds it causes an IBKR collision. Use the API (`/approve`, `/release`) for
state changes.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Results make no sense / staging not firing | Native uvicorn still on 8000 — Step 0 |
| `ERR_CONNECTION_REFUSED` | Container down → `docker compose up -d` |
| tmux *"no server running"* | Session died with a restart → recreate (Step 4) |
| *"Set a trigger price"* | TRIGGER is still `0` |
| UI changes not showing | `npm run build` first |
| `staging_error` populated | Read it — it says exactly what failed |
| Approvals fail `NoClientIdAvailable` | Range full of stale ids → Step 11 |

See `PENDING.md` for what's still missing, and `backend/README.md` for the full backend
reference.
