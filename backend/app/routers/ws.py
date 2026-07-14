"""WS /ws — push channel.

The frontend's only reaction to a message is to refetch the snapshot
immediately, so this exists to cut the 1.5s poll latency on events that matter
(a fill landing, an approval clearing). Vite proxies it with ws:true in dev.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..hub import hub

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await hub.connect(ws)
    try:
        while True:
            # We don't expect inbound traffic; this await is what keeps the
            # connection open and detects the client going away.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(ws)
