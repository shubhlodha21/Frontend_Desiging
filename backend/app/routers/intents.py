"""The launch-approval queue: MD submits, desk decides.

Flow:
    POST   /api/launch-intents              MD submits      -> PENDING_APPROVAL
    GET    /api/launch-intents              both poll (3s)
    POST   /api/launch-intents/{id}/approve desk approves    -> APPROVED
    POST   /api/launch-intents/{id}/reject  desk rejects     -> REJECTED

APPROVED is picked up by the engine loop, which flips it to LAUNCHED. The MD
screen treats APPROVED and LAUNCHED identically, so that hand-off is invisible
to the submitter.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from .. import staging
from ..db import get_session
from ..hub import hub
from ..models import IntentStatus, LaunchIntent, utcnow
from ..schemas import LaunchIntentCreate, LaunchIntentRead, RejectBody

router = APIRouter(prefix="/api/launch-intents", tags=["launch-intents"])


def _get_or_404(session: Session, intent_id: str) -> LaunchIntent:
    intent = session.get(LaunchIntent, intent_id)
    if intent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No intent {intent_id}")
    return intent


def _require_pending(intent: LaunchIntent) -> None:
    """Decisions are one-shot. Re-approving a LAUNCHED intent would re-open a
    position the engine already has; rejecting one would strand it."""
    if intent.status != IntentStatus.PENDING_APPROVAL:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{intent.symbol} is already {intent.status.value}",
        )


@router.post("", response_model=LaunchIntentRead, status_code=status.HTTP_201_CREATED)
async def submit(body: LaunchIntentCreate, session: Session = Depends(get_session)):
    """MD submits a strategy for desk approval. Nothing is placed here — the
    intent only becomes an order once someone approves it."""
    intent = LaunchIntent(**body.model_dump())
    session.add(intent)
    session.commit()
    session.refresh(intent)
    await hub.broadcast("intent.submitted", id=intent.id, symbol=intent.symbol)
    return intent


@router.get("", response_model=list[LaunchIntentRead])
def list_intents(
    session: Session = Depends(get_session),
    pending_only: bool = False,
    limit: int = 50,
):
    """Newest first. The MD poller filters client-side (pending + decided in the
    last 8s); the admin queue passes pending_only=true."""
    q = select(LaunchIntent).order_by(LaunchIntent.created_at.desc()).limit(limit)
    if pending_only:
        q = q.where(LaunchIntent.status == IntentStatus.PENDING_APPROVAL)
    return session.exec(q).all()


@router.get("/{intent_id}", response_model=LaunchIntentRead)
def get_intent(intent_id: str, session: Session = Depends(get_session)):
    return _get_or_404(session, intent_id)


@router.post("/{intent_id}/approve", response_model=LaunchIntentRead)
async def approve(
    intent_id: str,
    session: Session = Depends(get_session),
    admin: str = "admin",
):
    """Desk approves. The engine loop turns this into LAUNCHED within ~1s.

    TODO(auth): `admin` is a placeholder until JWT roles land. Right now anyone
    who can reach this port can approve an order.
    """
    intent = _get_or_404(session, intent_id)
    _require_pending(intent)
    intent.status = IntentStatus.APPROVED
    intent.decided_by = admin
    intent.decided_at = utcnow()
    session.add(intent)
    session.commit()
    session.refresh(intent)

    # Allocate a client-id and stage the run_live.py command in tmux, awaiting a
    # human Enter. Records its own errors rather than raising: a staging failure
    # must not undo a real decision, and the row carries the reason so the admin
    # screen can show "approved but not staged".
    staging.stage_intent(session, intent)

    await hub.broadcast("intent.approved", id=intent.id, symbol=intent.symbol)
    return intent


@router.get("/-/client-ids", tags=["staging"])
def client_ids(session: Session = Depends(get_session)):
    """Which client-ids are held right now, per side.

    Ranges come from config (LONG 1-100, SHORT 101-200 by default). Useful when
    a strategy dies without its id being released and allocation starts failing.
    """
    from .. import config

    return {"ranges": config.CLIENT_ID_RANGE, "in_use": staging.active_client_ids(session)}


@router.post("/{intent_id}/release", response_model=LaunchIntentRead)
def release(intent_id: str, session: Session = Depends(get_session)):
    """Hand a client-id back to the pool once its strategy has stopped.

    The backend can't see run_live.py exit, so this is manual. Without it the
    per-side range fills up and approvals start failing with NoClientIdAvailable.

    Only call this once the process is actually dead — releasing an id a live
    strategy still holds means the next approval collides with it on IBKR.
    """
    intent = _get_or_404(session, intent_id)
    staging.release_client_id(session, intent)
    session.refresh(intent)
    return intent


@router.post("/{intent_id}/reject", response_model=LaunchIntentRead)
async def reject(
    intent_id: str,
    body: RejectBody | None = None,
    session: Session = Depends(get_session),
    admin: str = "admin",
):
    """Desk rejects. Terminal — the engine never sees it."""
    intent = _get_or_404(session, intent_id)
    _require_pending(intent)
    intent.status = IntentStatus.REJECTED
    intent.decided_by = admin
    intent.decided_at = utcnow()
    intent.reject_reason = body.reason if body else None
    session.add(intent)
    session.commit()
    session.refresh(intent)
    await hub.broadcast("intent.rejected", id=intent.id, symbol=intent.symbol)
    return intent
