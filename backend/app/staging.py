"""Turn an approved intent into a command staged in tmux, awaiting a human Enter.

    approve → allocate client-id → build command → open tmux window → send-keys
                                                                      (no Enter)

The missing Enter is the whole safety model: the command sits on the prompt in
the right directory and a human reviews it before it runs. Nothing here executes
a trade.

Three things this module is careful about:

  1. **Injection.** `symbol` is user input and ends up in a string typed at a
     shell prompt. Every interpolated value goes through shlex.quote(), on top
     of the whitelist in schemas.py. Do not build this command with f-strings.
  2. **Client-id collisions.** IBKR refuses a second connection using an id
     already in use. Ids are allocated from the DB (per-side ranges) and held
     until explicitly released.
  3. **Blast radius.** GT_PAPER=false is real money. Staging is off by default
     and must be turned on per-box (see config.py).
"""

from __future__ import annotations

import re
import shlex
import subprocess
import time
from dataclasses import dataclass

from sqlmodel import Session, select

from . import config
from .models import IntentStatus, LaunchIntent, Side, utcnow


class StagingError(RuntimeError):
    pass


class NoClientIdAvailable(StagingError):
    pass


# ── client-id allocation ────────────────────────────────────────────────────
def allocate_client_id(session: Session, side: Side) -> int:
    """Lowest free id in this side's range.

    "In use" = held by an intent that hasn't been released. An id stays held
    while its strategy runs; releasing it is a deliberate act (release_client_id)
    because the backend cannot see run_live.py exit. Handing out an id that a
    live process still holds would break its IBKR connection.
    """
    lo, hi = config.CLIENT_ID_RANGE[side.value]
    taken = set(
        session.exec(
            select(LaunchIntent.client_id).where(
                LaunchIntent.client_id.is_not(None),
                LaunchIntent.client_id_released == False,  # noqa: E712 — SQL, not Python
            )
        ).all()
    )
    for cid in range(lo, hi + 1):
        if cid not in taken:
            return cid
    raise NoClientIdAvailable(
        f"No free client-id for {side.value} in {lo}-{hi}. "
        f"{len(taken)} held — release finished strategies first."
    )


def release_client_id(session: Session, intent: LaunchIntent) -> None:
    intent.client_id_released = True
    session.add(intent)
    session.commit()


# ── command building ────────────────────────────────────────────────────────
def _num(v: float) -> str:
    """Fixed-point, no scientific notation.

    A stop of 2e-05 formatted by str() becomes "2e-05", which argparse floats
    accept but humans misread at a glance — and this string exists to be read by
    a human before they hit Enter.
    """
    s = f"{v:.8f}".rstrip("0").rstrip(".")
    return s or "0"


def build_command(intent: LaunchIntent) -> str:
    """The exact line staged into the pane.

    Mirrors the desk's hand-typed form:
        GT_PAPER=false python3 run_live.py LULU --trigger 97.65 --port 7496 \
          --client-id 3 --offset-entry-pct 0.001 --stop 0.0020 --uvloop --qty 512
    """
    if intent.client_id is None:
        raise StagingError("client_id must be allocated before building the command")

    parts: list[str] = [
        f"GT_PAPER={'true' if intent.paper else 'false'}",
        config.PYTHON_BIN,
        config.RUN_SCRIPT,
        shlex.quote(intent.symbol),
        "--trigger", _num(intent.trigger),
        "--port", str(config.port_for(intent.paper)),
        "--client-id", str(intent.client_id),
    ]
    # The desk omits the flag entirely rather than passing 0 when there's no
    # offset — an explicit 0 means something different to run_live.py.
    if intent.offset is not None:
        parts += ["--offset-entry-pct", _num(intent.offset)]
    parts += ["--stop", _num(intent.stop)]
    if config.EXTRA_FLAGS:
        parts += shlex.split(config.EXTRA_FLAGS)
    parts += ["--qty", str(intent.qty)]
    return " ".join(parts)


# ── tmux ────────────────────────────────────────────────────────────────────
def _tmux(*args: str) -> subprocess.CompletedProcess:
    """Run tmux with argv (never shell=True — nothing here is shell-parsed)."""
    return subprocess.run(
        [config.TMUX_BIN, *args],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )


def _ensure_session() -> None:
    if _tmux("has-session", "-t", config.TMUX_SESSION).returncode == 0:
        return
    r = _tmux("new-session", "-d", "-s", config.TMUX_SESSION)
    if r.returncode != 0:
        raise StagingError(f"could not create tmux session: {r.stderr.strip()}")


def _window_name(intent: LaunchIntent) -> str:
    # symbol is whitelisted, client_id is an int — safe as a window name.
    return f"{intent.symbol}-{intent.client_id}"


_SHELLS = {"bash", "sh", "zsh", "dash", "fish", "ash"}


def _wait_for_shell(target: str, timeout: float = 5.0) -> None:
    """Block until the pane's shell is actually ready for input.

    `tmux new-window` returns as soon as the window exists — before bash has
    initialised readline and drawn its prompt. Keys sent into that gap get
    echoed as raw terminal output instead of landing in the input buffer. The
    failure mode that matters isn't "nothing typed", it's "HALF typed": a
    truncated command left on the prompt (`--qty 51` instead of `--qty 512`)
    that a human may well press Enter on.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = _tmux("display-message", "-p", "-t", target, "#{pane_current_command}")
        if r.returncode == 0 and r.stdout.strip() in _SHELLS:
            time.sleep(0.15)  # readline settles a beat after the process appears
            return
        time.sleep(0.1)


def _normalise(s: str) -> str:
    """Collapse whitespace so a wrapped pane capture can be compared to the
    command we sent. capture-pane -J rejoins wrapped lines, but spacing at the
    wrap point still varies."""
    return re.sub(r"\s+", " ", s).strip()


def _prompt_holds(target: str, command: str) -> bool:
    """Is the full command really sitting on the prompt, intact?

    This is the check that makes staging trustworthy: we do not report success
    unless we can see the exact command in the pane.
    """
    r = _tmux("capture-pane", "-p", "-J", "-t", target)
    if r.returncode != 0:
        return False
    return _normalise(command) in _normalise(r.stdout)


@dataclass
class Staged:
    command: str
    window: str | None
    mode: str


def stage(intent: LaunchIntent) -> Staged:
    """Open a window in the side's directory and type the command, unexecuted.

    Honours config.STAGING_MODE:
      off → nothing built
      dry → command built and returned, tmux untouched
      on  → window opened, command typed, waiting on Enter
    """
    mode = config.STAGING_MODE
    if mode == "off":
        return Staged(command="", window=None, mode="off")

    command = build_command(intent)
    if mode == "dry":
        return Staged(command=command, window=None, mode="dry")
    if mode != "on":
        raise StagingError(f"GT_STAGING must be off|dry|on, got {mode!r}")

    cwd = config.dir_for(intent.side.value)
    if not cwd.is_dir():
        raise StagingError(f"directory for {intent.side.value} does not exist: {cwd}")

    _ensure_session()
    window = _window_name(intent)

    r = _tmux("new-window", "-t", config.TMUX_SESSION, "-c", str(cwd), "-n", window)
    if r.returncode != 0:
        raise StagingError(f"tmux new-window failed: {r.stderr.strip()}")

    target = f"{config.TMUX_SESSION}:{window}"

    # Don't race the shell's startup — see _wait_for_shell.
    _wait_for_shell(target)

    # Two attempts: C-u clears anything already in the buffer (a stray echo from
    # startup, or a mangled first try) so a retry can't append to a partial line
    # and build a subtly wrong command.
    last_seen = ""
    for attempt in (1, 2):
        _tmux("send-keys", "-t", target, "C-u")
        # NO trailing "Enter" — this types the line and leaves it on the prompt.
        # Adding "Enter" here would fire a live order with no human in the loop.
        r = _tmux("send-keys", "-t", target, command)
        if r.returncode != 0:
            raise StagingError(f"tmux send-keys failed: {r.stderr.strip()}")
        if _prompt_holds(target, command):
            return Staged(command=command, window=window, mode="on")
        cap = _tmux("capture-pane", "-p", "-J", "-t", target)
        last_seen = _normalise(cap.stdout)[-200:]
        time.sleep(0.3)

    # Never claim a stage we couldn't verify. The window is left in place so it
    # can be inspected; the error lands on the intent row.
    raise StagingError(
        f"staged command did not land intact in {target} after 2 attempts. "
        f"pane tail: {last_seen!r}"
    )


def stage_intent(session: Session, intent: LaunchIntent) -> None:
    """Allocate, stage, and persist — recording failure rather than raising.

    A staging failure must not roll back the approval: the desk's decision is
    real and belongs in the audit trail either way. The error lands on the row
    so the admin screen can show "approved but not staged" instead of pretending
    everything worked.
    """
    # Off means off — allocating an id here would silently consume the 1-100
    # pool for a feature that isn't running.
    if config.STAGING_MODE == "off":
        return
    try:
        if intent.client_id is None:
            intent.client_id = allocate_client_id(session, intent.side)
        result = stage(intent)
        intent.staged_command = result.command or None
        intent.staged_window = result.window
        intent.staged_at = utcnow() if result.mode != "off" else None
        intent.staging_error = None
    except Exception as exc:
        intent.staging_error = f"{type(exc).__name__}: {exc}"
        # Hand the id back — a failed stage never connected to IBKR.
        if intent.client_id is not None and not intent.staged_command:
            intent.client_id_released = True
    session.add(intent)
    session.commit()
    session.refresh(intent)


def active_client_ids(session: Session) -> dict[str, list[int]]:
    """What's held right now, per side — for the admin screen / debugging."""
    rows = session.exec(
        select(LaunchIntent).where(
            LaunchIntent.client_id.is_not(None),
            LaunchIntent.client_id_released == False,  # noqa: E712
        )
    ).all()
    out: dict[str, list[int]] = {"LONG": [], "SHORT": []}
    for r in rows:
        if r.status in (IntentStatus.APPROVED, IntentStatus.LAUNCHED):
            out[r.side.value].append(r.client_id)
    return {k: sorted(v) for k, v in out.items()}
