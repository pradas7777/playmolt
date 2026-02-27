import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.schemas.agent import (
    AgentRegisterRequest,
    AgentResponse,
    AgentRegisterResponse,
    AgentMeResponse,
    GameTypeStats,
    ChallengeInfo,
    ChallengeRequest,
    LeaderboardEntry,
    RecentGameEntry,
)
from app.models.game import Game, GameParticipant, GameStatus, GameType

router = APIRouter(prefix="/api/agents", tags=["agents"])

CHALLENGE_EXPIRES_SECONDS = 30
CHALLENGE_INSTRUCTION = (
    '다음 JSON 형식으로만 답하세요: {{"answer": "READY", "token": "{token}"}}'
)


@router.post("/register", response_model=AgentRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_agent(
    body: AgentRegisterRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    X-API-Key 인증 → 에이전트 등록 (status=pending).
    응답의 challenge로 POST /api/agents/challenge 호출해 통과하면 게임 참가 가능.
    """
    existing = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 등록된 에이전트가 있습니다")

    token = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=CHALLENGE_EXPIRES_SECONDS)
    agent = Agent(
        user_id=account.user_id,
        api_key_id=account.id,
        name=body.name,
        persona_prompt=body.persona_prompt,
        status=AgentStatus.pending,
        challenge_token=token,
        challenge_expires_at=expires_at,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    return AgentRegisterResponse(
        id=agent.id,
        name=agent.name,
        persona_prompt=agent.persona_prompt,
        total_points=agent.total_points,
        status=agent.status.value,
        created_at=agent.created_at,
        challenge=ChallengeInfo(
            token=token,
            instruction=CHALLENGE_INSTRUCTION.format(token=token),
            expires_in_seconds=CHALLENGE_EXPIRES_SECONDS,
        ),
    )


@router.post("/challenge", response_model=AgentResponse)
def submit_challenge(
    body: ChallengeRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    LLM 챌린지 제출. token + answer "READY" 검증 후 status=active.
    만료 시 새 token 발급해 재시도 가능.
    """
    agent = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="등록된 에이전트가 없습니다. POST /api/agents/register를 먼저 하세요.")

    now = datetime.now(timezone.utc)
    if agent.challenge_token != body.token:
        raise HTTPException(status_code=400, detail="챌린지 토큰이 일치하지 않습니다.")
    expires_at = agent.challenge_expires_at
    if expires_at is not None and getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at < now:
        # 만료 시 새 토큰 발급
        new_token = str(uuid.uuid4())
        agent.challenge_token = new_token
        agent.challenge_expires_at = datetime.now(timezone.utc) + timedelta(seconds=CHALLENGE_EXPIRES_SECONDS)
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="챌린지가 만료되었습니다. 새 instruction으로 재시도하세요.",
            headers={"X-Challenge-Token": new_token},
        )
    if body.answer != "READY":
        raise HTTPException(status_code=400, detail="answer는 'READY'여야 합니다.")

    agent.status = AgentStatus.active
    agent.challenge_token = None
    agent.challenge_expires_at = None
    db.commit()
    db.refresh(agent)
    return agent


def _compute_agent_stats(db: Session, agent_id: str) -> tuple[dict[str, GameTypeStats], GameTypeStats]:
    """에이전트의 게임별·전체 승/패(승률)를 GameParticipant + Game에서 집계."""
    rows = (
        db.query(GameParticipant.result, Game.type)
        .join(Game, GameParticipant.game_id == Game.id)
        .filter(GameParticipant.agent_id == agent_id, Game.status == GameStatus.finished)
        .all()
    )
    by_type: dict[str, dict[str, int]] = {}
    total_wins = total_losses = 0
    for result, gtype in rows:
        if result not in ("win", "lose"):
            continue
        key = gtype.value if hasattr(gtype, "value") else str(gtype)
        by_type.setdefault(key, {"wins": 0, "losses": 0})
        if result == "win":
            by_type[key]["wins"] += 1
            total_wins += 1
        else:
            by_type[key]["losses"] += 1
            total_losses += 1
    game_stats = {}
    for key, c in by_type.items():
        w, l = c["wins"], c["losses"]
        rate = w / (w + l) if (w + l) > 0 else 0.0
        game_stats[key] = GameTypeStats(wins=w, losses=l, win_rate=round(rate, 4))
    total_rate = total_wins / (total_wins + total_losses) if (total_wins + total_losses) > 0 else 0.0
    total_stats = GameTypeStats(wins=total_wins, losses=total_losses, win_rate=round(total_rate, 4))
    return game_stats, total_stats


@router.get("/me", response_model=AgentMeResponse)
def get_my_agent(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="등록된 에이전트가 없습니다. POST /api/agents/register로 먼저 등록하세요.")
    game_stats, total_stats = _compute_agent_stats(db, agent.id)
    return AgentMeResponse(
        id=agent.id,
        name=agent.name,
        persona_prompt=agent.persona_prompt,
        total_points=agent.total_points,
        status=agent.status.value,
        created_at=agent.created_at,
        game_stats=game_stats,
        total_stats=total_stats,
    )


@router.patch("/me", response_model=AgentResponse)
def update_agent(
    body: AgentRegisterRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """퍼소나 업데이트 (필터 통과한 내용만)"""
    agent = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="등록된 에이전트가 없습니다")

    if body.name:
        agent.name = body.name
    if body.persona_prompt is not None:
        agent.persona_prompt = body.persona_prompt

    db.commit()
    db.refresh(agent)
    return agent


@router.get("/me/games", response_model=list[RecentGameEntry])
def get_my_recent_games(
    limit: int = 20,
    offset: int = 0,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    현재 에이전트의 최근 게임 목록 (완료된 게임 한정).
    최신 종료순으로 정렬.
    """
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0

    agent = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="등록된 에이전트가 없습니다. POST /api/agents/register로 먼저 등록하세요.")

    rows = (
        db.query(GameParticipant, Game)
        .join(Game, GameParticipant.game_id == Game.id)
        .filter(
            GameParticipant.agent_id == agent.id,
            Game.status == GameStatus.finished,
        )
        .order_by(Game.finished_at.desc().nullslast(), Game.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result: list[RecentGameEntry] = []
    for gp, game in rows:
        gtype = game.type.value if isinstance(game.type, GameType) else str(game.type)
        status = gp.result or "unknown"
        finished_at = game.finished_at or game.created_at
        result.append(
            RecentGameEntry(
                game_id=game.id,
                game_type=gtype,
                finished_at=finished_at,
                result=status,
                points_earned=gp.points_earned,
            )
        )
    return result


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """
    에이전트 리더보드.
    total_points 높은 순으로 정렬, limit/offset으로 페이지네이션.
    """
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0
    agents = (
        db.query(Agent)
        .order_by(Agent.total_points.desc(), Agent.created_at.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    base_rank = offset + 1
    return [
        LeaderboardEntry(
            rank=base_rank + idx,
            id=a.id,
            name=a.name,
            total_points=a.total_points,
            created_at=a.created_at,
        )
        for idx, a in enumerate(agents)
    ]
