# GT Desk backend — Linux image with tmux, for testing the staging path.
#
# Purpose: prove the tmux mechanics (new-window in the right dir, send-keys
# without Enter) on a real Linux box without needing WSL or the EC2.
#
# NOT the recommended way to run this on the EC2. If the API is containerised
# there, tmux lives inside the container — `tmux attach` on the host won't see
# it, and /srv/gt/long would be the container's directory, not your real one.
# Crossing that boundary needs docker-socket mounting or SSH-to-host, both bad
# ideas for something that stages live-money commands. Use systemd on the EC2.

FROM python:3.12-slim

# tmux is the point of this image. procps gives ps, for looking at what the
# staged windows are actually running. sqlite3 is for inspecting the audit
# trail directly:  docker compose exec api sqlite3 /data/gt_desk.db
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux procps curl sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps first — this layer caches across code edits.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Stand in for the EC2's per-side directories. Bind-mount your real ones over
# these if you want to stage against actual run_live.py copies.
RUN mkdir -p /srv/gt/long /srv/gt/short

ENV GT_LONG_DIR=/srv/gt/long \
    GT_SHORT_DIR=/srv/gt/short \
    GT_DIST_DIR=/app/dist \
    GT_DB_PATH=/data/gt_desk.db \
    GT_TMUX_SESSION=gt \
    GT_STAGING=dry \
    PYTHONUNBUFFERED=1

# /data is a volume in compose — keeps the DB (and audit trail) across rebuilds.
VOLUME ["/data"]

EXPOSE 8000

# 0.0.0.0 so the port is reachable from the host. Inside a container that's
# fine — the container's network boundary is the control. Do NOT copy this
# host setting to the EC2, where 127.0.0.1 + an SSH tunnel is the safe default
# until auth exists.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
