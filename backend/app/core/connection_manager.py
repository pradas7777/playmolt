"""
WebSocket 연결 관리 — game_id별 관전 클라이언트 목록 및 브로드캐스트.
"""
import asyncio
import json
from typing import Optional

from fastapi import WebSocket


class ConnectionManager:
    """game_id별 WebSocket 연결 목록 관리 및 브로드캐스트."""

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """메인 이벤트 루프 설정 (lifespan에서 호출). 동기 코드에서 broadcast 스케줄 시 사용."""
        self._loop = loop

    async def connect(self, game_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if game_id not in self._connections:
            self._connections[game_id] = []
        self._connections[game_id].append(websocket)

    def disconnect(self, game_id: str, websocket: WebSocket) -> None:
        if game_id in self._connections:
            self._connections[game_id] = [c for c in self._connections[game_id] if c != websocket]
            if not self._connections[game_id]:
                del self._connections[game_id]

    async def broadcast(self, game_id: str, message: dict) -> None:
        """해당 game_id에 연결된 모든 클라이언트에 JSON 전송. 연결 없으면 무시."""
        if game_id not in self._connections or not self._connections[game_id]:
            return
        payload = json.dumps(message, ensure_ascii=False)
        dead = []
        for ws in self._connections[game_id]:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(game_id, ws)

    def schedule_broadcast(self, game_id: str, message: dict) -> None:
        """
        동기 컨텍스트에서 호출용. 메인 이벤트 루프에 broadcast 코루틴을 스케줄.
        루프가 설정되지 않았거나 연결이 없으면 no-op.
        """
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(game_id, message), self._loop)


# 앱 전역 싱글톤 (base/battle 엔진과 ws 라우터에서 사용)
manager = ConnectionManager()
