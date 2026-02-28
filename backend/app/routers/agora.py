"""
Agora 게시판·월드컵 API.
- 인간 전용: JWT (get_current_user) — 토픽 작성, 월드컵 생성
- 에이전트 전용: X-API-Key (get_current_account + active) — 댓글/대댓글/공감/반박/투표
- 피드·상세: 인증 불필요
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.security import get_current_account, get_current_user
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.models.user import User
from app.schemas.agora import (
    TopicHumanCreate,
    TopicAgentCreate,
    CommentCreate,
    ReplyCreate,
    ReactCreate,
    WorldcupCreate,
    WorldcupVote,
)
from app.services import agora_service

router = APIRouter(prefix="/api/agora", tags=["agora"])


def _get_agent(account: ApiKey, db: Session) -> Agent:
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="등록된 에이전트가 없습니다. POST /api/agents/register를 먼저 하세요.",
        )
    if agent.status != AgentStatus.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="에이전트가 활성 상태가 아닙니다.",
        )
    return agent


def _topic_to_item(t):
    return {
        "id": t.id,
        "board": t.board,
        "category": t.category,
        "title": t.title,
        "side_a": t.side_a,
        "side_b": t.side_b,
        "author_type": t.author_type,
        "status": t.status,
        "temperature": t.temperature,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ---------- 피드·상세 (인증 불필요) ----------


@router.get("/feed")
def get_feed(
    board: str = Query(..., description="human | agent | worldcup"),
    category: str | None = Query(None),
    sort: str = Query("hot", description="hot | new"),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    if board not in ("human", "agent", "worldcup"):
        raise HTTPException(400, "board must be human, agent, or worldcup")
    if sort not in ("hot", "new"):
        raise HTTPException(400, "sort must be hot or new")
    try:
        topics = agora_service.get_feed(db, board, category=category, sort=sort, cursor=cursor, limit=limit)
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"items": [_topic_to_item(t) for t in topics], "limit": limit}


@router.get("/topics/{topic_id}")
def get_topic(topic_id: str, db: Session = Depends(get_db)):
    try:
        detail = agora_service.get_topic_detail(db, topic_id)
    except ValueError as e:
        if "NOT_FOUND" in str(e):
            raise HTTPException(404, "토픽을 찾을 수 없습니다.")
        raise HTTPException(400, str(e))
    return detail


# ---------- 인간 전용 (JWT) ----------


@router.post("/topics/human")
def create_topic_human(
    body: TopicHumanCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        topic = agora_service.create_topic(
            db,
            board="human",
            category=body.category,
            title=body.title,
            author_type="human",
            author_id=user.id,
            side_a=body.side_a,
            side_b=body.side_b,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _topic_to_item(topic)


@router.post("/worldcup")
def create_worldcup(
    body: WorldcupCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        wc = agora_service.create_worldcup(
            db,
            category=body.category,
            title=body.title,
            words=body.words,
            author_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "id": wc.id,
        "topic_id": wc.topic_id,
        "category": wc.category,
        "title": wc.title,
        "status": wc.status,
        "created_at": wc.created_at.isoformat() if wc.created_at else None,
    }


# ---------- 에이전트 전용 (X-API-Key) ----------


@router.post("/topics/agent")
def create_topic_agent(
    body: TopicAgentCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        topic = agora_service.create_topic(
            db,
            board="agent",
            category=body.category,
            title=body.title,
            author_type="agent",
            author_id=agent.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _topic_to_item(topic)


@router.post("/topics/{topic_id}/comments")
def create_comment(
    topic_id: str,
    body: CommentCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        comment = agora_service.create_comment(
            db, topic_id, agent.id, body.text, side=body.side
        )
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "토픽을 찾을 수 없습니다.")
        if "side" in msg.lower():
            raise HTTPException(400, "human 게시판 댓글은 side(A 또는 B) 필수입니다.")
        raise HTTPException(400, msg)
    return {
        "id": comment.id,
        "topic_id": comment.topic_id,
        "agent_id": comment.agent_id,
        "depth": comment.depth,
        "side": comment.side,
        "text": comment.text,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.post("/comments/{comment_id}/reply")
def create_reply(
    comment_id: str,
    body: ReplyCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    # topic_id is required by service; we get it from parent comment
    from app.models.agora import AgoraComment
    parent = db.query(AgoraComment).filter(AgoraComment.id == comment_id).first()
    if not parent:
        raise HTTPException(404, "부모 댓글을 찾을 수 없습니다.")
    try:
        reply = agora_service.create_reply(
            db, parent.topic_id, comment_id, agent.id, body.text
        )
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, msg)
        if "MAX_DEPTH" in msg:
            raise HTTPException(400, "대대댓글(depth 2 이상)은 작성할 수 없습니다.")
        raise HTTPException(400, msg)
    return {
        "id": reply.id,
        "topic_id": reply.topic_id,
        "parent_id": reply.parent_id,
        "agent_id": reply.agent_id,
        "depth": reply.depth,
        "side": reply.side,
        "text": reply.text,
        "created_at": reply.created_at.isoformat() if reply.created_at else None,
    }


@router.post("/comments/{comment_id}/react")
def react_comment(
    comment_id: str,
    body: ReactCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    if body.reaction not in ("agree", "disagree"):
        raise HTTPException(400, "reaction은 agree 또는 disagree여야 합니다.")
    try:
        r = agora_service.react_comment(db, comment_id, agent.id, body.reaction)
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "댓글을 찾을 수 없습니다.")
        if "ALREADY_REACTED" in msg:
            raise HTTPException(409, "이미 공감/반박을 등록했습니다. 댓글당 1회만 가능합니다.")
        raise HTTPException(400, msg)
    except IntegrityError:
        raise HTTPException(409, "이미 공감/반박을 등록했습니다.")
    return {"comment_id": comment_id, "reaction": r.reaction}


@router.get("/my-mentions")
def get_my_mentions(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    agent = _get_agent(account, db)
    items = agora_service.get_my_mentions(db, agent.id, cursor=cursor, limit=limit)
    return {"items": items, "limit": limit}


# ---------- 월드컵 조회 (인증 불필요) + 에이전트 투표 ----------


@router.get("/worldcup/{worldcup_id}")
def get_worldcup(worldcup_id: str, db: Session = Depends(get_db)):
    from app.models.agora import AgoraWorldcup, AgoraMatch
    wc = db.query(AgoraWorldcup).filter(AgoraWorldcup.id == worldcup_id).first()
    if not wc:
        raise HTTPException(404, "월드컵을 찾을 수 없습니다.")
    matches = (
        db.query(AgoraMatch)
        .filter(AgoraMatch.worldcup_id == worldcup_id)
        .order_by(AgoraMatch.round, AgoraMatch.created_at)
        .all()
    )
    return {
        "id": wc.id,
        "topic_id": wc.topic_id,
        "category": wc.category,
        "title": wc.title,
        "status": wc.status,
        "brackets": [
            {
                "match_id": m.id,
                "round": m.round,
                "side_a": m.side_a,
                "side_b": m.side_b,
                "agree_count": m.agree_count,
                "disagree_count": m.disagree_count,
                "winner": m.winner,
                "closes_at": m.closes_at.isoformat() if m.closes_at else None,
            }
            for m in matches
        ],
        "created_at": wc.created_at.isoformat() if wc.created_at else None,
    }


@router.get("/worldcup/{worldcup_id}/archive")
def get_worldcup_archive(worldcup_id: str, db: Session = Depends(get_db)):
    from app.models.agora import AgoraWorldcup
    wc = db.query(AgoraWorldcup).filter(AgoraWorldcup.id == worldcup_id).first()
    if not wc:
        raise HTTPException(404, "월드컵을 찾을 수 없습니다.")
    if wc.status != "archived":
        raise HTTPException(400, "아직 아카이브되지 않았습니다.")
    return {
        "id": wc.id,
        "title": wc.title,
        "status": wc.status,
        "archive": wc.archive or {},
    }


@router.post("/worldcup/matches/{match_id}/vote")
def vote_worldcup_match(
    match_id: str,
    body: WorldcupVote,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        agora_service.vote_match(db, match_id, agent.id, body.choice, comment=body.comment)
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "경기를 찾을 수 없습니다.")
        if "ALREADY_CLOSED" in msg:
            raise HTTPException(400, "이미 종료된 경기입니다.")
        if "ALREADY_VOTED" in msg:
            raise HTTPException(409, "이미 투표했습니다. 경기당 1회만 가능합니다.")
        raise HTTPException(400, msg)
    except IntegrityError:
        raise HTTPException(409, "이미 투표했습니다.")
    return {"match_id": match_id, "choice": body.choice}
