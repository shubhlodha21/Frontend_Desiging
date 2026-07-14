"""Deployment config — everything that differs between your laptop and the EC2.

All env-driven so nothing box-specific is baked into the code.

GT_STAGING is the safety switch, and it defaults to **off**:

    off   no command is built, approval just marks the intent (dev default)
    dry   build + store the command, but do NOT touch tmux  ← test with this
    on    build + store + open a tmux window with the command staged

`off` is the default deliberately. There is no tmux on a Windows dev box, and a
bug that silently stages live-money commands is worse than one that does
nothing. Turn it up explicitly, on the box where you mean it.
"""

import os
from pathlib import Path

# Where run_live.py lives, per side. The approved intent's side picks one.
LONG_DIR = Path(os.getenv("GT_LONG_DIR", "/srv/gt/long"))
SHORT_DIR = Path(os.getenv("GT_SHORT_DIR", "/srv/gt/short"))

# tmux session that holds the staged windows. Created on demand if absent.
TMUX_SESSION = os.getenv("GT_TMUX_SESSION", "gt")
TMUX_BIN = os.getenv("GT_TMUX_BIN", "tmux")

# IBKR TWS/Gateway ports. paper=True → paper port, paper=False → live port.
IB_PORT_LIVE = int(os.getenv("GT_IB_PORT_LIVE", "7496"))
IB_PORT_PAPER = int(os.getenv("GT_IB_PORT_PAPER", "7497"))

# Client-id ranges, per side. IBKR rejects duplicate ids on concurrent
# connections, so these are allocated from the DB and never reused while held.
CLIENT_ID_RANGE = {
    "LONG": (int(os.getenv("GT_LONG_CID_MIN", "1")), int(os.getenv("GT_LONG_CID_MAX", "100"))),
    "SHORT": (int(os.getenv("GT_SHORT_CID_MIN", "101")), int(os.getenv("GT_SHORT_CID_MAX", "200"))),
}

# off | dry | on
STAGING_MODE = os.getenv("GT_STAGING", "off").strip().lower()

PYTHON_BIN = os.getenv("GT_PYTHON_BIN", "python3")
RUN_SCRIPT = os.getenv("GT_RUN_SCRIPT", "run_live.py")
EXTRA_FLAGS = os.getenv("GT_EXTRA_FLAGS", "--uvloop")

# Built frontend. Defaults to ../../dist relative to this file, which is right
# for a repo checkout; in a container the layout differs, so it's overridable.
DIST_DIR = Path(os.getenv("GT_DIST_DIR", str(Path(__file__).resolve().parents[2] / "dist")))

# SQLite location. Overridable so a container can put it on a mounted volume
# rather than inside the image, where it would vanish on rebuild.
DB_PATH = Path(os.getenv("GT_DB_PATH", str(Path(__file__).resolve().parents[1] / "gt_desk.db")))


def dir_for(side: str) -> Path:
    return LONG_DIR if side == "LONG" else SHORT_DIR


def port_for(paper: bool) -> int:
    return IB_PORT_PAPER if paper else IB_PORT_LIVE
