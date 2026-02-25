import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.core.join_queue import (
    enqueue,
    pop_n,
    get_required_count,
    put_back,
    put_back_unique,
    remove_self_on_timeout,
    QUEUE_WAIT_TIMEOUT_SEC,
)
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.models.game import Game, GameParticipant, GameStatus
from app.schemas.game import JoinGameRequest, ActionRequest
from app.services.game_service import create_game_for_agents, get_engine
from app.core.config import settings

logger = logging.getLogger(__name__)


def _close_abandoned_game_if_any(agent_id: str, db: Session) -> None:
    """
    이 에이전트가 참가 중인 게임 중 running/waiting 이면서
    시작 후 ABANDONED_GAME_MINUTES 초과한 것은 방치 게임으로 보고 finished 처리.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=settings.ABANDONED_GAME_MINUTES)
    active = (
        db.query(GameParticipant)
        .join(Game)
        .filter(
            GameParticipant.agent_id == agent_id,
            Game.status.in_([GameStatus.waiting, GameStatus.running]),
        )
        .first()
    )
    if not active:
        return
    game = db.query(Game).filter_by(id=active.game_id).first()
    if not game:
        return
    # started_at 없으면 created_at 기준으로 판단 (대기 방이 오래 방치된 경우)
    ref_time = game.started_at or game.created_at
    if ref_time and getattr(ref_time, "tzinfo", None) is None:
        ref_time = ref_time.replace(tzinfo=timezone.utc)
    if ref_time and ref_time < cutoff:
        game.status = GameStatus.finished
        game.finished_at = now
        db.commit()
        logger.info("join: abandoned game closed game_id=%s agent_id=%s (ref_time=%s)", game.id, agent_id, ref_time)


router = APIRouter(prefix="/api/games", tags=["games"])


def _get_agent(account: ApiKey, db: Session) -> Agent:
    """API Key → Agent 조회 + 상태 검증"""
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(404, "등록된 에이전트가 없습니다. POST /api/agents/register를 먼저 하세요.")
    if agent.status != AgentStatus.active:
        logger.warning("join rejected agent_id=%s status=%s (challenge 미통과)", agent.id, agent.status)
        raise HTTPException(status_code=403, detail="AGENT_NOT_VERIFIED")
    return agent


@router.post("/join")
async def join_game(
    request: Request,
    body: JoinGameRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    대기열 기반 참가. 한 줄로 세우고 4명이 모이면 새 방 1개를 만들어 4명을 동시에 배정.
    방치된 게임(시작 후 N시간 경과)은 자동으로 finished 처리 후 참가 허용.
    """
    client = getattr(request.state, "client", None) or request.client
    host = client.host if client else "?"
    logger.info("join 요청 수신 game_type=%s client=%s (응답은 대기 끝나면 전송됨)", body.game_type, host)
    agent = _get_agent(account, db)

    _close_abandoned_game_if_any(agent.id, db)

    active = db.query(GameParticipant).join(Game).filter(
        GameParticipant.agent_id == agent.id,
        Game.status.in_([GameStatus.waiting, GameStatus.running])
    ).first()
    if active:
        # game_id를 메시지에 넣지 않음 → 외부 클라이언트가 409를 파싱해 기존 게임으로 잘못 진입하는 것 방지
        raise HTTPException(409, "ALREADY_IN_GAME")

    event, result_holder, size_after = enqueue(body.game_type, agent.id)
    logger.info("join enqueue game_type=%s agent_id=%s size_after=%s", body.game_type, agent.id, size_after)

    required = get_required_count(body.game_type)
    if size_after >= required:
        popped = pop_n(body.game_type, required)
        if popped:
            agent_ids, events_and_results = popped
            if len(set(agent_ids)) < required:
                logger.warning("join pop_n 중복 에이전트 있어 유일만 put_back_unique game_type=%s agent_ids=%s", body.game_type, agent_ids)
                put_back_unique(body.game_type, agent_ids, events_and_results)
            else:
                try:
                    logger.info("join pop_n game_type=%s agent_ids=%s", body.game_type, agent_ids)
                    game = create_game_for_agents(body.game_type, agent_ids, db)
                    game_id = game.id
                    for ev, res in events_and_results:
                        res[0] = game_id
                        ev.set()
                    logger.info("join game created game_id=%s notifying %s waiters", game_id, len(events_and_results))
                    if agent.id in agent_ids:
                        return {
                            "success": True,
                            "game_id": game_id,
                            "game_type": game.type.value,
                            "status": game.status.value,
                            "message": "게임에 참가했습니다. GET /api/games/{game_id}/state로 상태를 확인하세요.",
                        }
                except ValueError as e:
                    if "서로 다른" in str(e) or "distinct" in str(e).lower():
                        logger.warning("join create_game_for_agents 실패(중복 등), put_back_unique agent_ids=%s err=%s", agent_ids, e)
                        put_back_unique(body.game_type, agent_ids, events_and_results)
                    else:
                        raise
    # 필요 인원 미만이면 대기
    try:
        await asyncio.to_thread(lambda: event.wait(timeout=QUEUE_WAIT_TIMEOUT_SEC))
    except asyncio.CancelledError:
        remove_self_on_timeout(body.game_type, result_holder)
        raise
    game_id = result_holder[0]
    if game_id is None:
        logger.warning("join timeout agent_id=%s game_type=%s", agent.id, body.game_type)
        remove_self_on_timeout(body.game_type, result_holder)
        raise HTTPException(408, "매칭 대기 시간이 초과되었습니다. 다시 시도해 주세요.")
    logger.info("join waiter got game_id=%s agent_id=%s", game_id, agent.id)
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
        raise HTTPException(400, detail=result)

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

    if game.status != GameStatus.finished:
        raise HTTPException(400, "게임이 아직 끝나지 않았습니다.")

    engine = get_engine(game, db)
    return engine.get_state(agent)


def _get_game(game_id: str, db: Session) -> Game:
    game = db.query(Game).filter_by(id=game_id).first()
    if not game:
        raise HTTPException(404, "게임을 찾을 수 없습니다.")
    return game
