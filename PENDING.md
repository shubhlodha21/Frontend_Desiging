# PENDING — outstanding work

Everything not done yet, roughly in the order it should be tackled.
Current state: **working prototype, tested locally. Not production-ready.**

Last updated: 14 Jul 2026

---

## 🔴 Blockers before a live account

### 1. No authentication

`approve` / `reject` take a hardcoded `admin: str = "admin"` placeholder. **Anyone who
can reach `/?admin=1` can approve an order** — and with `GT_STAGING=on` that means
staging a `GT_PAPER=false` (real money) command on the trading box. The MD/admin
split is currently two URLs, not two identities: nothing stops an MD opening the
admin page and approving their own order.

Deferred during testing. **Must be closed before the site is publicly reachable.**

Decisions already made (14 Jul 2026):

| Question | Decision |
|---|---|
| Admin scope | **Approve only** — admins cannot submit |
| Self-approval | Allowed *(moot: if admins can't submit, they never have an own order)* |
| Accounts | **Single shared admin password** — no per-user identity |

Consequence of the shared password: `decided_by` records *"an admin approved"*, never
**which** admin. If per-person attribution is ever needed (likely for real money),
upgrading to env-var user:password pairs is a small change — same JWT plumbing.

Scope when built:
- `POST /api/auth/login` → signed JWT carrying role + expiry
- `require_role("admin")` dependency on approve / reject / release
- `md` role required to submit
- Login screen; token in browser storage; sent on every request
- Keep `/api/health` and the static mount public, or the login page can't load

### 2. Interim mitigation — do this now if the EC2 goes up before auth

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000   # NOT 0.0.0.0
ssh -L 8000:127.0.0.1:8000 ubuntu@your-ec2          # reach it only via SSH
```

Only someone with SSH access can then reach the admin panel. A stopgap, not a fix.

### 3. No risk checks

`POST /api/launch-intents` validates **shape only** (qty ≥ 1, trigger > 0, stop ≤ 0.99,
symbol charset). Nothing checks:

- Buying power / account equity
- Position limits, per-symbol or desk-wide
- Duplicate symbol already running
- Notional sanity (a fat-fingered qty passes today)

---

## 🟠 Before the EC2 deploy

### 4. Never run on the actual EC2

The tmux path is proven **in a Linux container on Windows**, not on the real box.
Untested there: the real `/srv/gt/*` paths, systemd, tmux session ownership, IB Gateway.

**Rollout order — do not skip:**

1. `GT_STAGING=dry`, bound to `127.0.0.1` → read `staged_command`, confirm it is
   byte-for-byte what you'd type by hand
2. `GT_STAGING=on` + **paper** (`paper: true` → port 7497, `GT_PAPER=true`) → attach
   to tmux, press Enter yourself, watch it connect
3. **Only then** live (`paper: false` → port 7496)

Skipping to 3 makes your first real execution also your first test of the whole chain.

### 5. systemd will kill live strategies

If the service creates the tmux server, tmux lands in the service's cgroup and
`systemctl restart gt-api` **kills tmux — and every running strategy with it.**

```bash
tmux new-session -d -s gt          # create OUTSIDE the service, before it starts
```

```ini
# /etc/systemd/system/gt-api.service
[Service]
User=ubuntu                 # MUST match whoever runs `tmux attach -t gt`
KillMode=process            # do NOT nuke the cgroup on restart
ExecStart=/srv/gt/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
```

tmux sessions are **per-user**: if systemd runs as `root` and you attach as `ubuntu`,
you'll see no windows and think staging is broken.

### 6. IB Gateway / TWS must be on the box

`--port 7496` assumes TWS or IB Gateway is listening locally. Headless EC2 usually
means IB Gateway + IBC for auto-login, plus a plan for the daily restart and 2FA.
Its own project if not already running.

### 7. No database backups

`gt_desk.db` is the audit trail of who approved what — compliance evidence on a live
desk, not just data. Currently a single SQLite file on one EBS volume. No backup, no
replication. Postgres + snapshots when it leaves one machine.

---

## 🟡 Functional gaps

### 8. The engine is a stub

`backend/app/engine.py` random-walks synthetic prices. It has **no connection to real
trading**. Replace `_tick()` with real market data and `adopt_approved()` with real
order placement — the API contract above it doesn't change.

The backend also has **no idea whether `run_live.py` actually ran, succeeded, or died**.
Which causes:

### 9. Client-id release is manual

Ids are allocated from the DB (LONG 1-100 / SHORT 101-200) and **held until explicitly
released**. The backend can't see `run_live.py` exit, so:

```
POST /api/launch-intents/{id}/release      hand one back
GET  /api/launch-intents/-/client-ids      see what's held
```

Skip it and the range fills until approvals fail with `NoClientIdAvailable`. Only
release once the process is genuinely dead — releasing one a live strategy still holds
means the next approval collides with it on IBKR.

Ideally: the engine reports strategy exit and the id frees automatically.

### 10. Desktop Positions table shows demo data

`src/MdScreen.jsx:93` uses `generateMdData()`, not `useMdData()`. An approved position
appears on the **mobile** screen and in `/api/snapshot` but **not** in the desktop
Positions table. Switching it breaks the "Regenerate demo" button — open decision.

### 11. Desktop approval feedback is weak

When the desk approves, the amber "Awaiting Desk Approval" card just **vanishes** — no
success state. Mobile shows a proper Dynamic Island ("Approved by desk", green check).

---

## 🟢 Hygiene / tech debt

### 12. Nothing is committed

The **entire backend is untracked**. Last commit is `b704de3` (the .gitignore one).

```powershell
git add backend/ compose.yml src/ .gitignore Shubh_Changes.md PENDING.md
git commit -m "Add FastAPI backend: launch approval flow, admin panel, tmux staging"
```

(`.claude/`, `.cursorrules`, `GEMINI.md` etc. are AI-tool configs — ignore unless wanted.)

### 13. `src/.syncthing.MdScreen.jsx.tmp` still tracked

A Syncthing temp artifact (1188 lines) committed by accident. Its contents **differ**
from the real `MdScreen.jsx` (1527 lines) — a stale mid-sync snapshot. `.gitignore`
covers the pattern for new files but won't untrack this one.

```powershell
git rm --cached "src/.syncthing.MdScreen.jsx.tmp"
```

Diff it against `MdScreen.jsx` first in case it holds work that never landed.

### 14. No automated tests

Everything has been verified by hand. Worth having at minimum:
- `build_command()` output matches the desk's format exactly
- Client-id allocation: ranges, no reuse while held, reclaim after release
- Symbol whitelist blocks injection, allows real tickers (BRK.B, RDS-A)
- Status transitions + the 409 on double-decide

### 15. No migrations (Alembic)

`create_all()` only creates missing **tables** — it will not add columns to an existing
one. After a model change: either delete `gt_desk.db` (loses the audit trail) or
`ALTER TABLE ... ADD COLUMN` by hand (as was done on 14 Jul for the staging columns).

### 16. Two databases — a live confusion

| DB | Used by |
|---|---|
| `backend/gt_desk.db` | native `uvicorn` on Windows |
| `/data/gt_desk.db` (Docker volume) | the container |

Completely separate. The admin panel at `localhost:8000` reads **whichever server is
answering** — and both can bind port 8000 on Windows (IPv4 vs IPv6), so it's easy to
test the wrong one. Stop one before testing.

### 17. npm audit: 2 vulnerabilities

`esbuild` (moderate) → `vite` (high, inherited). **Dev-only**, no effect on the
production build. `npm audit fix --force` wants a breaking Vite upgrade — treat as a
deliberate task, not a quick fix.

### 18. Project lives in OneDrive + Syncthing

`node_modules` is sync-churned by two tools; `.DS_Store` and the Syncthing temp file
show it's synced from a Mac. Classic source of `EPERM`/`EBUSY` during installs. Moving
to `C:\dev\` would remove a whole class of problems.

---

## Reference — how to run it today

```powershell
# Docker (Linux + tmux, the full staging path)
docker compose up -d
docker compose exec api tmux attach -t gt      # Ctrl+B then D to detach
docker compose exec api sqlite3 /data/gt_desk.db -box "SELECT symbol,status,client_id FROM launch_intents;"

# Native (no tmux on Windows — dry mode only)
cd backend
$env:GT_STAGING = "dry"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

| URL | |
|---|---|
| `localhost:8000/` | MD desk |
| `localhost:8000/?admin=1` | Admin approval queue |
| `localhost:8000/docs` | API docs |

Frontend changes need `npm run build` before `:8000` serves them. Backend `.py` changes
need `docker compose restart api` (the `app/` folder is bind-mounted — no rebuild).

See `backend/README.md` for the full backend reference and `Shubh_Changes.md` for the
project scan.
