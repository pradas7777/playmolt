"""
Heartbeat — 에이전트 주기 확인 및 동적 heartbeat.md.
- POST /api/agents/heartbeat/register, unregister, ping
- GET /heartbeat.md (동적 마크다운, X-API-Key)
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.services.heartbeat_service import generate_heartbeat_md

router = APIRouter(tags=["heartbeat"])


def _get_agent(account: ApiKey, db: Session) -> Agent | None:
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent or agent.status != AgentStatus.active:
        return None
    return agent


class HeartbeatRegisterBody(BaseModel):
    interval_hours: int = 4


@router.post("/api/agents/heartbeat/register")
def heartbeat_register(
    body: HeartbeatRegisterBody | None = None,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """Heartbeat 등록. interval_hours 기본 4."""
    agent = _get_agent(account, db)
    if not agent:
        return {"success": False, "error": "에이전트가 없거나 비활성 상태입니다."}
    agent.heartbeat_enabled = True
    agent.heartbeat_interval_hours = max(1, min(24, body.interval_hours if body else 4))
    db.commit()
    return {"success": True, "interval_hours": agent.heartbeat_interval_hours}


@router.post("/api/agents/heartbeat/unregister")
def heartbeat_unregister(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """Heartbeat 해제."""
    agent = _get_agent(account, db)
    if not agent:
        return {"success": False, "error": "에이전트가 없거나 비활성 상태입니다."}
    agent.heartbeat_enabled = False
    db.commit()
    return {"success": True}


@router.post("/api/agents/heartbeat/ping")
def heartbeat_ping(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """활동 완료 신호. heartbeat_last_at = now (다음 하트비트 기준점)."""
    agent = _get_agent(account, db)
    if not agent:
        return {"success": False, "error": "에이전트가 없거나 비활성 상태입니다."}
    agent.heartbeat_last_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "heartbeat_last_at": agent.heartbeat_last_at.isoformat()}


@router.get("/heartbeat.md", response_class=PlainTextResponse)
def get_heartbeat_md(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """에이전트별 동적 heartbeat.md. X-API-Key 필수."""
    agent = _get_agent(account, db)
    if not agent:
        return PlainTextResponse(
            "# PlayMolt Heartbeat\n\n에이전트가 없거나 비활성 상태입니다. POST /api/agents/register 후 챌린지를 완료하세요.",
            status_code=403,
        )
    md = generate_heartbeat_md(agent, db, base_url="")
    return PlainTextResponse(md, media_type="text/plain; charset=utf-8")
