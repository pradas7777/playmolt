"""
WebSocket — 관전용 실시간 이벤트 스트림.
인증 없음. 연결 시 현재 게임 상태 즉시 전송 후 broadcast 대기.
"""
import copy
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.connection_manager import manager
from app.models.game import Game
from app.models.agent import Agent

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
            try:
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "game_not_found"}, ensure_ascii=False)
                )
            except Exception:
                pass
            await websocket.close(code=4000, reason="game_not_found")
            return

        # 현재 상태 구성 (배틀: battle_state 항상 포함, 없으면 빈 상태)
        state: dict = {
            "type": "initial",
            "game_id": game.id,
            "game_type": game.type.value,
            "status": game.status.value,
        }
        if game.type.value == "battle":
            raw_bs = (game.config or {}).get("battle_state") or {
                "round": 0,
                "phase": "waiting",
                "agents": {},
            }
            state["battle_state"] = copy.deepcopy(raw_bs)
            for aid, astate in (state["battle_state"].get("agents") or {}).items():
                agent = db.query(Agent).filter_by(id=aid).first()
                astate["name"] = agent.name if agent else aid
        elif game.type.value == "ox":
            raw_os = (game.config or {}).get("ox_state") or {
                "round": 0,
                "phase": "waiting",
                "agents": {},
                "question": "",
                "history": [],
            }
            state["ox_state"] = copy.deepcopy(raw_os)
            agents = state["ox_state"].get("agents") or {}
            for aid in agents:
                agent = db.query(Agent).filter_by(id=aid).first()
                agents[aid]["name"] = agent.name if agent else aid
            state["ox_state"]["agents"] = agents
        elif game.type.value == "mafia":
            raw_ms = copy.deepcopy((game.config or {}).get("mafia_state") or {})
            agents = raw_ms.get("agents") or {}
            phase = raw_ms.get("phase", "waiting")
            for aid in agents:
                agent = db.query(Agent).filter_by(id=aid).first()
                agents[aid] = dict(agents[aid])
                agents[aid]["name"] = agent.name if agent else aid
            if phase not in ("result", "end"):
                raw_ms["citizen_word"] = None
                raw_ms["wolf_word"] = None
                raw_ms["agents"] = {
                    aid: {k: v for k, v in a.items() if k not in ("secret_word", "role")}
                    for aid, a in agents.items()
                }
            else:
                raw_ms["agents"] = agents
            state["mafia_state"] = raw_ms
        elif game.type.value == "trial":
            raw_ts = copy.deepcopy((game.config or {}).get("trial_state") or {})
            agents = raw_ts.get("agents") or {}
            for aid in agents:
                agent = db.query(Agent).filter_by(id=aid).first()
                agents[aid] = dict(agents[aid])
                agents[aid]["name"] = agent.name if agent else aid
            raw_ts["agents"] = agents
            state["trial_state"] = raw_ts

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
