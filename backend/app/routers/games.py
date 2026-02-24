from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.core.join_queue import (
    enqueue,
    pop_four,
    remove_self_on_timeout,
    QUEUE_WAIT_TIMEOUT_SEC,
)
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.models.game import Game
from app.schemas.game import JoinGameRequest, ActionRequest
from app.services.game_service import create_game_for_agents, get_engine

router = APIRouter(prefix="/api/games", tags=["games"])


def _get_agent(account: ApiKey, db: Session) -> Agent:
    """API Key → Agent 조회 + 상태 검증"""
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(404, "등록된 에이전트가 없습니다. POST /api/agents/register를 먼저 하세요.")
    if agent.status != AgentStatus.active:
        raise HTTPException(status_code=403, detail="AGENT_NOT_VERIFIED")
    return agent


@router.post("/join")
def join_game(
    body: JoinGameRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    대기열 기반 참가. 한 줄로 세우고 4명이 모이면 새 방 1개를 만들어 4명을 동시에 배정.
    """
    agent = _get_agent(account, db)

    from app.models.game import GameParticipant, GameStatus
    active = db.query(GameParticipant).join(Game).filter(
        GameParticipant.agent_id == agent.id,
        Game.status.in_([GameStatus.waiting, GameStatus.running])
    ).first()
    if active:
        raise HTTPException(409, f"이미 진행 중인 게임이 있습니다. game_id: {active.game_id}")

    event, result_holder, size_after = enqueue(body.game_type, agent.id)

    if size_after >= 4:
        # 4번째(이상) 입장 → 4명 빼서 방 만들고 모두에게 game_id 전달
        popped = pop_four(body.game_type)
        if popped:
            agent_ids, events_and_results = popped
            game = create_game_for_agents(body.game_type, agent_ids, db)
            game_id = game.id
            for ev, res in events_and_results:
                res[0] = game_id
                ev.set()
            return {
                "success": True,
                "game_id": game_id,
                "game_type": game.type.value,
                "status": game.status.value,
                "message": "게임에 참가했습니다. GET /api/games/{game_id}/state로 상태를 확인하세요.",
            }
        # 동시에 여러 명이 4번째가 된 경우 등: pop_four가 None이면 그냥 대기
    # 4명 미만이면 대기
    event.wait(timeout=QUEUE_WAIT_TIMEOUT_SEC)
    game_id = result_holder[0]
    if game_id is None:
        remove_self_on_timeout(body.game_type, result_holder)
        raise HTTPException(408, "매칭 대기 시간이 초과되었습니다. 다시 시도해 주세요.")
    return {
        "success": True,
        "game_id": game_id,
        "game_type": body.game_type,
        "status": "running",
        "message": "게임에 참가했습니다. GET /api/games/{game_id}/state로 상태를 확인하세요.",
    }


@router.get("/{game_id}/state")
def get_state(
    game_id: str,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """현재 게임 상태 조회. 봇이 매 턴 호출하는 엔드포인트."""
    agent = _get_agent(account, db)
    game = _get_game(game_id, db)

    engine = get_engine(game, db)
    return engine.get_state(agent)


@router.post("/{game_id}/action")
def post_action(
    game_id: str,
    body: ActionRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """행동 제출. 전원 제출 시 자동으로 라운드 결과 적용."""
    agent = _get_agent(account, db)
    game = _get_game(game_id, db)

    engine = get_engine(game, db)
    result = engine.process_action(agent, body.model_dump())

    if not result["success"]:
        raise HTTPException(400, result["error"])

    return result


@router.get("/{game_id}/result")
def get_result(
    game_id: str,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """게임 최종 결과 조회."""
    agent = _get_agent(account, db)
    game = _get_game(game_id, db)

    from app.models.game import GameStatus
    if game.status != GameStatus.finished:
        raise HTTPException(400, "게임이 아직 끝나지 않았습니다.")

    engine = get_engine(game, db)
    return engine.get_state(agent)


def _get_game(game_id: str, db: Session) -> Game:
    game = db.query(Game).filter_by(id=game_id).first()
    if not game:
        raise HTTPException(404, "게임을 찾을 수 없습니다.")
    return game
