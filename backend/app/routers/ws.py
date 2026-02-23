"""
WebSocket — 관전용 실시간 이벤트 스트림.
인증 없음. 연결 시 현재 게임 상태 즉시 전송 후 broadcast 대기.
"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.connection_manager import manager
from app.models.game import Game

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/games/{game_id}")
async def websocket_spectate(
    websocket: WebSocket,
    game_id: str,
    db: Session = Depends(get_db),
):
    """
    관전용 WebSocket. 연결 즉시 현재 게임 상태 전송, 이후 라운드/게임 종료 이벤트 수신.
    인증 없음. Depends(get_db) 사용으로 테스트 시 dependency override 적용.
    """
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        if not game:
            await websocket.close(code=1000)
            return

        # 현재 상태 구성 (배틀: battle_state 포함)
        state: dict = {
            "type": "initial",
            "game_id": game.id,
            "game_type": game.type.value,
            "status": game.status.value,
        }
        if game.type.value == "battle" and game.config:
            state["battle_state"] = game.config.get("battle_state")

        await manager.connect(game_id, websocket)
        await websocket.send_text(json.dumps(state, ensure_ascii=False))

        # 클라이언트 연결 유지 및 disconnect 감지
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        manager.disconnect(game_id, websocket)
