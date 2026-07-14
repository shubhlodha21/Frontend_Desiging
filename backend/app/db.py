"""SQLite engine + session helper.

SQLite is deliberate for now: the approval queue must survive a restart (an
in-memory list would drop pending orders on reload, which is unacceptable for
an audit trail), but there's no need for a server yet. Swap the URL for
Postgres when this leaves one machine — no other change is required.
"""

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from . import config

# Overridable via GT_DB_PATH so a container can keep the DB on a mounted volume
# — inside the image it would be lost on every rebuild, taking the audit trail
# with it.
DB_PATH = config.DB_PATH
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False: FastAPI runs handlers on a threadpool, so a session
# may touch the connection from a different thread than the one that made it.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
