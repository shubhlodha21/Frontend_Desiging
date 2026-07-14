"""WebSocket fan-out.

The frontend ignores the payload entirely — any inbound message just triggers
an immediate refetch (see useMdData in src/lib/liveFeed.js and the /ws handler).
So this only needs to be a nudge, not a data channel. We still send a typed
payload so the admin screen can be smarter later without a protocol change.
"""

import asyncio
from typing import Any

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def broadcast(self, event: str, **data: Any) -> None:
        """Nudge every client. Dead sockets are dropped rather than raised —
        a disconnected admin tab must not fail the MD's approve request."""
        async with self._lock:
            targets = list(self._clients)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json({"event": event, **data})
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)


hub = Hub()
