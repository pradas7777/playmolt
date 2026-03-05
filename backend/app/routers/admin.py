"""
Admin APIs.

Auth:
- Preferred: POST /api/admin/login -> Bearer token
- Compatible: X-Admin-Secret header (legacy)
"""
from datetime import datetime, timezone, timedelta
import logging
from typing import Optional, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.agent import Agent, AgentStatus
from app.models.agora import (
    AgoraTopic,
    AgoraComment,
    AgoraReaction,
    AgoraWorldcup,
    AgoraMatch,
    AgoraMatchVote,
)
from app.models.game import Game, GameStatus
from app.models.point_log import PointLog

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])
bearer_scheme = HTTPBearer(auto_error=False)
ADMIN_TOKEN_EXPIRE_MINUTES = 60 * 8


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_seconds: int


class PointAdjustRequest(BaseModel):
    mode: Literal["set", "add"] = "set"
    value: int = Field(...)
    reason: str | None = Field(default=None, max_length=120)


def _create_admin_token(username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": f"admin:{username}", "admin": True, "exp": exp}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
):
    # Legacy secret path (kept for compatibility)
    if settings.ADMIN_SECRET and x_admin_secret == settings.ADMIN_SECRET:
        return "legacy-secret"

    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Admin auth required.")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid admin token.")

    if payload.get("admin") is not True:
        raise HTTPException(status_code=403, detail="Not an admin token.")
    return payload.get("sub", "admin")


@router.post("/login", response_model=AdminTokenResponse)
def admin_login(body: AdminLoginRequest):
    if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin login is not configured.")
    if body.username != settings.ADMIN_USERNAME or body.password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin credentials.")
    token = _create_admin_token(body.username)
    return AdminTokenResponse(
        access_token=token,
        expires_in_seconds=ADMIN_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/agents/{agent_id}/suspend")
def suspend_agent(
    agent_id: str,
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent.status = AgentStatus.suspended
    db.commit()
    return {"agent_id": agent.id, "status": agent.status.value}


@router.post("/agents/{agent_id}/unsuspend")
def unsuspend_agent(
    agent_id: str,
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent.status = AgentStatus.active
    db.commit()
    return {"agent_id": agent.id, "status": agent.status.value}


@router.patch("/agents/{agent_id}/points")
def adjust_agent_points(
    agent_id: str,
    body: PointAdjustRequest,
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")

    before = agent.total_points or 0
    if body.mode == "set":
        after = body.value
    else:
        after = before + body.value
    if after < 0:
        raise HTTPException(status_code=400, detail="total_points cannot be negative.")

    delta = after - before
    agent.total_points = after
    db.add(
        PointLog(
            agent_id=agent.id,
            game_id=None,
            delta=delta,
            reason=body.reason or f"admin_{body.mode}",
        )
    )
    db.commit()
    return {"agent_id": agent.id, "before": before, "after": after, "delta": delta}


def _delete_comment_tree(db: Session, root_comment_id: str) -> int:
    descendants = (
        db.query(AgoraComment)
        .filter((AgoraComment.id == root_comment_id) | (AgoraComment.parent_id == root_comment_id))
        .all()
    )
    if not descendants:
        return 0
    ids = [c.id for c in descendants]
    db.query(AgoraReaction).filter(AgoraReaction.comment_id.in_(ids)).delete(synchronize_session=False)
    deleted = db.query(AgoraComment).filter(AgoraComment.id.in_(ids)).delete(synchronize_session=False)
    return int(deleted or 0)


@router.delete("/agora/comments/{comment_id}")
def delete_agora_comment(
    comment_id: str,
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    deleted = _delete_comment_tree(db, comment_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Comment not found.")
    db.commit()
    return {"deleted_comments": deleted}


@router.delete("/agora/topics/{topic_id}")
def delete_agora_topic(
    topic_id: str,
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    topic = db.query(AgoraTopic).filter(AgoraTopic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found.")

    comment_ids = [cid for (cid,) in db.query(AgoraComment.id).filter(AgoraComment.topic_id == topic_id).all()]
    if comment_ids:
        db.query(AgoraReaction).filter(AgoraReaction.comment_id.in_(comment_ids)).delete(synchronize_session=False)
        db.query(AgoraComment).filter(AgoraComment.id.in_(comment_ids)).delete(synchronize_session=False)

    wc_ids = [wid for (wid,) in db.query(AgoraWorldcup.id).filter(AgoraWorldcup.topic_id == topic_id).all()]
    if wc_ids:
        match_ids = [mid for (mid,) in db.query(AgoraMatch.id).filter(AgoraMatch.worldcup_id.in_(wc_ids)).all()]
        if match_ids:
            db.query(AgoraMatchVote).filter(AgoraMatchVote.match_id.in_(match_ids)).delete(synchronize_session=False)
            db.query(AgoraMatch).filter(AgoraMatch.id.in_(match_ids)).delete(synchronize_session=False)
        db.query(AgoraWorldcup).filter(AgoraWorldcup.id.in_(wc_ids)).delete(synchronize_session=False)

    db.delete(topic)
    db.commit()
    return {"deleted_topic_id": topic_id}


@router.post("/games/cleanup-abandoned")
def cleanup_abandoned_games(
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(minutes=max(1, int(settings.ABANDONED_GAME_MINUTES)))
    target = (
        db.query(Game)
        .filter(Game.status.in_([GameStatus.waiting, GameStatus.running]))
        .all()
    )
    closed_ids: list[str] = []
    for game in target:
        ref = game.started_at or game.created_at
        if ref and getattr(ref, "tzinfo", None) is None:
            ref = ref.replace(tzinfo=timezone.utc)
        if ref and ref < threshold:
            game.status = GameStatus.finished
            game.finished_at = now
            closed_ids.append(game.id)
    if closed_ids:
        db.commit()
    logger.info("admin cleanup-abandoned: closed=%s", len(closed_ids))
    return {"closed": len(closed_ids), "game_ids": closed_ids}


@router.post("/games/close-all-in-progress")
def close_all_in_progress(
    _: str = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    """
    Immediate emergency close for all waiting/running games.
    """
    now = datetime.now(timezone.utc)
    target = db.query(Game).filter(Game.status.in_([GameStatus.waiting, GameStatus.running])).all()
    count = 0
    for game in target:
        game.status = GameStatus.finished
        game.finished_at = now
        count += 1
    if count:
        db.commit()
        logger.info("admin close-all-in-progress: closed %s games", count)
    return {"closed": count, "message": f"{count} games closed."}
