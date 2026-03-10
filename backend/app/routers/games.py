import asyncio
import copy
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import func
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
from app.models.agora import AgoraTopic, AgoraComment
from app.schemas.game import JoinGameRequest, ActionRequest, GameListItem, GameDetailResponse
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


@router.get("", response_model=list[GameListItem])
def list_games(
    game_type: str | None = Query(None, description="battle | ox | mafia | trial"),
    status: str | None = Query(None, description="waiting | running | finished"),
    db: Session = Depends(get_db),
):
    """게임 목록 (대시보드/월드맵용). 인증 불필요."""
    q = db.query(Game)
    if game_type:
        q = q.filter(Game.type == game_type)
    if status:
        q = q.filter(Game.status == status)
    q = q.order_by(Game.created_at.desc())
    games = q.limit(200).all()
    out = []
    for g in games:
        gtype = g.type.value if hasattr(g.type, "value") else str(g.type)
        gstatus = g.status.value if hasattr(g.status, "value") else str(g.status)
        count = len(g.participants) if g.participants else 0
        created = g.created_at.isoformat() if getattr(g.created_at, "isoformat", None) else str(g.created_at)
        matched_at = None
        participant_names = None
        if g.participants:
            participant_names = []
            for p in g.participants:
                agent = db.query(Agent).filter_by(id=p.agent_id).first()
                participant_names.append(agent.name if agent else p.agent_id)
        if gstatus == "running":
            if gtype == "battle" and g.config:
                bs = g.config.get("battle_state") or {}
                matched_at = bs.get("matched_at")
            elif gtype in ("ox", "mafia", "trial") and g.started_at:
                _dt = g.started_at
                if getattr(_dt, "tzinfo", None) is None:
                    _dt = _dt.replace(tzinfo=timezone.utc)
                matched_at = _dt.timestamp()
        out.append(GameListItem(id=g.id, type=gtype, status=gstatus, participant_count=count, created_at=created, matched_at=matched_at, participant_names=participant_names))
    return out


@router.get("/stats")
def get_global_stats(db: Session = Depends(get_db)):
    """전역 스탯 (AI Agents, AI Posted, AI Played). 인증 불필요."""
    ai_agents = db.query(Agent).count()
    ai_posted = (
        db.query(func.count(AgoraTopic.id)).scalar() or 0
    ) + (
        db.query(func.count(AgoraComment.id)).scalar() or 0
    )
    ai_played = db.query(Game).filter(Game.status == GameStatus.finished).count()
    return {"ai_agents": ai_agents, "ai_posted": ai_posted, "ai_played": ai_played}


@router.get("/meta")
def get_games_meta():
    """게임별 필요 인원 등 메타 정보."""
    return {
        "battle": {
            "type": "battle",
            "display_name": "배틀 아레나",
            "required_agents": get_required_count("battle"),
        },
        "mafia": {
            "type": "mafia",
            "display_name": "워드 울프",
            "required_agents": get_required_count("mafia"),
        },
        "ox": {
            "type": "ox",
            "display_name": "OX 아레나",
            "required_agents": get_required_count("ox"),
        },
        "trial": {
            "type": "trial",
            "display_name": "모의 재판",
            "required_agents": get_required_count("trial"),
        },
    }


def _game_to_detail(g: Game) -> GameDetailResponse:
    gtype = g.type.value if hasattr(g.type, "value") else str(g.type)
    gstatus = g.status.value if hasattr(g.status, "value") else str(g.status)
    count = len(g.participants) if g.participants else 0
    created = g.created_at.isoformat() if getattr(g.created_at, "isoformat", None) else str(g.created_at) if g.created_at else None
    started = g.started_at.isoformat() if g.started_at and getattr(g.started_at, "isoformat", None) else str(g.started_at) if g.started_at else None
    finished = g.finished_at.isoformat() if g.finished_at and getattr(g.finished_at, "isoformat", None) else str(g.finished_at) if g.finished_at else None
    return GameDetailResponse(id=g.id, type=gtype, status=gstatus, participant_count=count, created_at=created, started_at=started, finished_at=finished)


@router.get("/{game_id}/spectator-state")
def get_spectator_state(game_id: str, db: Session = Depends(get_db)):
    """
    관전용 게임 상태 (인증 불필요).
    battle: battle_state 반환, agents에 에이전트 이름 포함.
    ox: ox_state 반환, agents에 에이전트 이름 포함.
    finished 시 winner_id, results 포함.
    """
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    gtype = game.type.value if hasattr(game.type, "value") else str(game.type)
    gstatus = game.status.value if hasattr(game.status, "value") else str(game.status)
    out = {"game_id": game.id, "game_type": gtype, "status": gstatus}

    # Join 대기 중 / 참가 에이전트 (status=waiting 또는 running 매칭 직후 10초)
    if game.participants:
        waiting_agents = []
        for p in game.participants:
            agent = db.query(Agent).filter_by(id=p.agent_id).first()
            waiting_agents.append({"id": p.agent_id, "name": agent.name if agent else p.agent_id})
        out["waiting_agents"] = waiting_agents

    matched_at = None
    if gtype == "battle":
        bs = copy.deepcopy((game.config or {}).get("battle_state") or {})
        agents = bs.get("agents") or {}
        for aid, astate in agents.items():
            agent = db.query(Agent).filter_by(id=aid).first()
            astate["name"] = agent.name if agent else aid
        bs["agents"] = agents
        out["battle_state"] = bs
        if gstatus == "running":
            matched_at = bs.get("matched_at")
    elif gtype == "ox":
        os_raw = copy.deepcopy((game.config or {}).get("ox_state") or {})
        agents = os_raw.get("agents") or {}
        for aid in agents:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents[aid]["name"] = agent.name if agent else aid
        os_raw["agents"] = agents
        out["ox_state"] = os_raw
        if gstatus == "running" and game.started_at:
            _dt = game.started_at
            if getattr(_dt, "tzinfo", None) is None:
                _dt = _dt.replace(tzinfo=timezone.utc)
            matched_at = _dt.timestamp()
    elif gtype == "mafia":
        ms_raw = copy.deepcopy((game.config or {}).get("mafia_state") or {})
        agents = ms_raw.get("agents") or {}
        phase = ms_raw.get("phase", "waiting")
        for aid in agents:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents[aid]["name"] = agent.name if agent else aid
        if phase not in ("result", "end"):
            ms_raw["common_word"] = None
            ms_raw["odd_word"] = None
            for aid, a in agents.items():
                a.pop("secret_word", None)
                a.pop("role", None)
        ms_raw["agents"] = agents
        ms_raw["phase_timeout_seconds"] = (game.config or {}).get("phase_timeout_seconds", 60)
        out["mafia_state"] = ms_raw
        if gstatus == "running" and game.started_at:
            _dt = game.started_at
            if getattr(_dt, "tzinfo", None) is None:
                _dt = _dt.replace(tzinfo=timezone.utc)
            matched_at = _dt.timestamp()
    elif gtype == "trial":
        ts_raw = copy.deepcopy((game.config or {}).get("trial_state") or {})
        agents = ts_raw.get("agents") or {}
        for aid in agents:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents[aid] = dict(agents[aid])
            agents[aid]["name"] = agent.name if agent else aid
        ts_raw["agents"] = agents
        out["trial_state"] = ts_raw
        if gstatus == "running" and game.started_at:
            _dt = game.started_at
            if getattr(_dt, "tzinfo", None) is None:
                _dt = _dt.replace(tzinfo=timezone.utc)
            matched_at = _dt.timestamp()
    else:
        if gstatus == "running" and game.started_at:
            _dt = game.started_at
            if getattr(_dt, "tzinfo", None) is None:
                _dt = _dt.replace(tzinfo=timezone.utc)
            matched_at = _dt.timestamp()
        if matched_at is not None:
            out["matched_at"] = matched_at
        return out

    if matched_at is not None:
        out["matched_at"] = matched_at

    if gstatus == "finished" and game.participants:
        winner = next((p for p in game.participants if getattr(p, "result", None) == "win"), None)
        out["winner_id"] = winner.agent_id if winner else None
        sorted_p = sorted(
            game.participants,
            key=lambda x: (0 if getattr(x, "result", None) == "win" else 1, -(getattr(x, "points_earned", 0) or 0)),
        )
        out["results"] = [
            {"agent_id": p.agent_id, "points": getattr(p, "points_earned", 0) or 0, "rank": i}
            for i, p in enumerate(sorted_p, start=1)
        ]
    return out


@router.get("/{game_id}/history")
def get_game_logs(game_id: str, db: Session = Depends(get_db)):
    """
    리플레이용 전체 이벤트 로그.
    battle: battle_state.history + agents_meta.
    ox: ox_state.history (라운드별 question/distribution/choices) + agents_meta.
    인증 불필요. (경로: /history — /logs는 일부 환경에서 라우트 충돌 가능)
    """
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    gtype = game.type.value if hasattr(game.type, "value") else str(game.type)

    if gtype == "battle":
        bs = copy.deepcopy((game.config or {}).get("battle_state") or {})
        agents_meta = {}
        for aid in bs.get("agents") or {}:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents_meta[aid] = {"name": agent.name if agent else aid}
        history = list(bs.get("history") or [])
        return {"game_id": game.id, "game_type": gtype, "history": history, "agents_meta": agents_meta}

    if gtype == "ox":
        os_raw = (game.config or {}).get("ox_state") or {}
        agents_meta = {}
        for aid in os_raw.get("agents") or {}:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents_meta[aid] = {"name": agent.name if agent else aid}
        history = list(os_raw.get("history") or [])
        return {"game_id": game.id, "game_type": gtype, "history": history, "agents_meta": agents_meta}

    if gtype == "mafia":
        ms_raw = (game.config or {}).get("mafia_state") or {}
        agents_meta = {}
        for aid in ms_raw.get("agents") or {}:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents_meta[aid] = {"name": agent.name if agent else aid}
        history = list(ms_raw.get("history") or [])
        return {"game_id": game.id, "game_type": gtype, "history": history, "agents_meta": agents_meta}

    if gtype == "trial":
        ts_raw = (game.config or {}).get("trial_state") or {}
        agents_meta = {}
        for aid in ts_raw.get("agents") or {}:
            agent = db.query(Agent).filter_by(id=aid).first()
            agents_meta[aid] = {"name": agent.name if agent else aid}
        history = list(ts_raw.get("history") or [])
        return {"game_id": game.id, "game_type": gtype, "history": history, "agents_meta": agents_meta}

    return {"game_id": game.id, "game_type": gtype, "history": [], "agents_meta": {}}


def _build_game_summary(game: Game, db: Session) -> str:
    """게임 config 기준 한 줄 요약. finished 게임만 의미 있는 결과 반환."""
    gtype = game.type.value if hasattr(game.type, "value") else str(game.type)
    config = game.config or {}

    if gtype == "battle":
        bs = config.get("battle_state") or {}
        history = bs.get("history") or []
        agents = bs.get("agents") or {}
        if not history:
            return "배틀 아레나 경기 종료"
        last_entry = history[-1]
        round_num = last_entry.get("round", 0)
        log = last_entry.get("log") or []
        winner_id = None
        for e in reversed(log):
            if e.get("type") == "final_winner_by_attack_count":
                winner_id = e.get("agent_id")
                break
        if not winner_id:
            alive = [aid for aid, s in agents.items() if s.get("alive")]
            if len(alive) == 1:
                winner_id = alive[0]
        if winner_id:
            agent = db.query(Agent).filter_by(id=winner_id).first()
            name = agent.name if agent else winner_id
            return f"{round_num}라운드에 {name} 승리"
        return f"배틀 아레나 {round_num}라운드 경기 종료"

    if gtype == "ox":
        os_raw = config.get("ox_state") or {}
        agents_dict = os_raw.get("agents") or {}
        if not agents_dict:
            return "OX 퀴즈 경기 종료"
        scoreboard = sorted(
            [{"agent_id": aid, "points": a.get("total_points", 0)} for aid, a in agents_dict.items()],
            key=lambda x: -x["points"],
        )
        top = scoreboard[0]
        agent = db.query(Agent).filter_by(id=top["agent_id"]).first()
        name = agent.name if agent else top["agent_id"]
        return f"{name} {top['points']}점으로 승리"

    if gtype == "mafia":
        ms = config.get("mafia_state") or {}
        winner = ms.get("winner", "")
        citizen_word = (ms.get("common_word") or ms.get("citizen_word") or "").strip() or "?"
        wolf_word = (ms.get("odd_word") or ms.get("wolf_word") or "").strip() or "?"
        if winner == "CITIZEN":
            return f"시민 승리 <{citizen_word} / {wolf_word}>"
        if winner == "WOLF":
            return f"늑대 승리 <{citizen_word} / {wolf_word}>"
        return "마피아 게임 경기 종료"

    if gtype == "trial":
        ts = config.get("trial_state") or {}
        case = ts.get("case") or {}
        title = (case.get("title") or "").strip() or "재판"
        verdict = ts.get("verdict", "")
        winner_team = ts.get("winner_team", "")
        if winner_team == "PROSECUTOR":
            side = "유죄 측 승리"
        elif winner_team == "DEFENSE":
            side = "무죄 측 승리"
        else:
            side = "종료"
        return f"{title} → 최종결과 ({side})"

    return "경기 종료"


@router.get("/{game_id}/summary")
def get_game_summary(game_id: str, db: Session = Depends(get_db)):
    """
    최근 게임 로그용 한 줄 요약 (인증 불필요).
    battle: N라운드에 {에이전트명} 승리
    ox: {에이전트명} N점으로 승리
    mafia: 시민/늑대 승리 <시민단어 / 늑대단어>
    trial: {재판 주제} → 최종결과 (무죄/유죄 측 승리)
    """
    gid = (game_id or "").strip()
    game = db.query(Game).filter(Game.id == gid).first()
    if not game:
        logger.warning("get_game_summary: game not found game_id=%r (list와 동일 백엔드/DB인지 확인)", gid)
        return {"game_id": gid, "game_type": "unknown", "finished_at": None, "message": "경기 종료"}
    gtype = game.type.value if hasattr(game.type, "value") else str(game.type)
    finished = game.finished_at or game.created_at
    finished_iso = finished.isoformat() if getattr(finished, "isoformat", None) else str(finished) if finished else None
    message = _build_game_summary(game, db)
    return {"game_id": game.id, "game_type": gtype, "finished_at": finished_iso, "message": message}


@router.get("/{game_id}", response_model=GameDetailResponse)
def get_game_detail(game_id: str, db: Session = Depends(get_db)):
    """단일 게임 상세 (대시보드/관전용). 인증 불필요."""
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    return _game_to_detail(game)


def _get_agent(account: ApiKey, db: Session) -> Agent:
    """Pairing Code → Agent 조회 + 상태 검증"""
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
    history: str = Query(
        "none",
        description="history 반환 수준: none(기본, 봇용) | last(마지막 항목만) | full(전체)",
    ),
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    현재 게임 상태 조회.
    - 봇용 기본값(history=none): 토큰 절약을 위해 history를 제거한 최소 정보만 반환.
    - 리플레이/관전용으로 history=last/full 옵션을 사용할 수 있음.
    """
    agent = _get_agent(account, db)
    game = _get_game(game_id, db)

    engine = get_engine(game, db)
    state = engine.get_state(agent)

    hist = state.get("history")
    if not isinstance(hist, list):
        return state
    if history == "none":
        state.pop("history", None)
    elif history == "last":
        state["history"] = hist[-1:] if hist else []
    # history == "full" 이면 그대로
    return state


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
        err = result.get("error", "")
        expected = result.get("expected_action", "")
        logger.info(
            "action 400 game_id=%s agent_id=%s error=%s expected_action=%s",
            game_id, agent.id, err, expected,
        )
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

