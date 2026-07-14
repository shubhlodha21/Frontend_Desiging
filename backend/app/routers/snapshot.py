"""GET /api/snapshot — the positions feed the MD screen polls every 1.5s.

Returns [] when nothing is launched. The frontend reads an empty array as
"backend up, no bots" (mode: "live-empty") rather than falling back to demo
data, so an empty list is a meaningful answer, not an error.
"""

from fastapi import APIRouter

from ..engine import engine
from ..schemas import SymbolSnapshot

router = APIRouter(prefix="/api", tags=["snapshot"])


@router.get("/snapshot", response_model=list[SymbolSnapshot])
def snapshot():
    return engine.snapshot()
