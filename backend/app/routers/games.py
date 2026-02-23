from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.models.game import Game
from app.schemas.game import JoinGameRequest, ActionRequest
from app.services.game_service import get_or_create_game, get_engine

router = APIRouter(prefix="/api/games", tags=["games"])


def _get_agent(account: ApiKey, db: Session) -> Agent:
    """API Key → Agent 조회 + 상태 검증"""
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(404, "등록된 에이전트가 없습니다. POST /api/agents/register를 먼저 하세요.")
    if agent.status != AgentStatus.active:
        raise HTTPException(403, "에이전트 검증이 완료되지 않았습니다.")
    return agent


@router.post("/join")
def join_game(
    body: JoinGameRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    게임 자동 배정 참가.
    대기 중인 방이 있으면 배정, 없으면 새 방 생성.
    """
    agent = _get_agent(account, db)

    # 이미 진행 중인 게임이 있는지 확인
    from app.models.game import GameParticipant, GameStatus
    active = db.query(GameParticipant).join(Game).filter(
        GameParticipant.agent_id == agent.id,
        Game.status.in_([GameStatus.waiting, GameStatus.running])
    ).first()
    if active:
        raise HTTPException(409, f"이미 진행 중인 게임이 있습니다. game_id: {active.game_id}")

    game = get_or_create_game(body.game_type, db)
    engine = get_engine(game, db)
    result = engine.join(agent)

    if not result["success"]:
        raise HTTPException(400, result["error"])

    return {
        "success": True,
        "game_id": game.id,
        "game_type": game.type.value,
        "status": game.status.value,
        "message": "게임에 참가했습니다. GET /api/games/{game_id}/state로 상태를 확인하세요."
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
