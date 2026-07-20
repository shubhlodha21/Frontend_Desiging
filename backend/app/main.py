"""GT Desk backend.

    uvicorn app.main:app --reload --port 8000

Port 8000 is not arbitrary — vite.config.js proxies /api and /ws there, so the
frontend reaches this same-origin in dev with no CORS involved. Point it
elsewhere with GT_API_TARGET on the Vite side.
"""

import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from . import config
from .db import engine as db_engine
from .db import init_db
from .engine import engine
from .hub import hub
from .routers import control, fills, history, intents, snapshot, ws

TICK_SECONDS = 1.0


async def engine_loop() -> None:
    """Adopt approved intents and walk prices, once a second.

    Runs in-process for now. When the real engine lands it becomes a separate
    service and this loop goes away — the API contract stays put.
    """
    while True:
        try:
            with Session(db_engine) as session:
                launched = engine.adopt_approved(session)
            engine.tick()
            for symbol in launched:
                await hub.broadcast("intent.launched", symbol=symbol)
        except Exception as exc:  # a bad tick must not kill the loop
            print(f"[engine] tick failed: {exc!r}")
        await asyncio.sleep(TICK_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(engine_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="GT Desk API", version="0.1.0", lifespan=lifespan)

# Dev-only. In dev the Vite proxy makes everything same-origin, so this matters
# only if you hit :8000 directly from a browser on another port. Tighten before
# this is exposed anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(intents.router)
app.include_router(snapshot.router)
app.include_router(ws.router)
app.include_router(fills.router)
app.include_router(history.router)
app.include_router(control.router)


@app.get("/api/health")
def health():
    return {"ok": True, "positions": len(engine.positions)}


# ── serve the built frontend ────────────────────────────────────────────────
# This is what makes the app hostable as ONE service. vite.config.js's /api
# proxy exists only under `npm run dev`; a production build is static files with
# no proxy, so without this mount every /api call from the built app 404s.
#
# Mounted LAST and at "/": Starlette matches registered routes first, so the
# API and /ws still win. Anything else falls through to the built assets.
# html=True serves index.html at "/", which is all the frontend needs — its
# routing is query-string based (?admin=1), not path based, so there are no
# deep links needing an SPA fallback.
DIST = config.DIST_DIR
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
else:
    # Dev with Vite on :5173 is the normal case for this — not an error.
    print(f"[static] no build at {DIST} — run `npm run build` to serve the UI from :8000")
