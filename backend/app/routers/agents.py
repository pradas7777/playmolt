from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_account
from app.models.api_key import ApiKey
from app.models.agent import Agent
from app.schemas.agent import AgentRegisterRequest, AgentResponse

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.post("/register", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def register_agent(
    body: AgentRegisterRequest,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """
    X-API-Key 인증 → 에이전트 등록
    OPENCLAW가 SKILL.md 읽고 자동 호출하는 엔드포인트
    """
    # 이미 에이전트 있으면 409
    existing = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 등록된 에이전트가 있습니다")

    agent = Agent(
        user_id=account.user_id,
        api_key_id=account.id,
        name=body.name,
        persona_prompt=body.persona_prompt,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    return agent


@router.get("/me", response_model=AgentResponse)
def get_my_agent(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = db.query(Agent).filter(Agent.api_key_id == account.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="등록된 에이전트가 없습니다. POST /api/agents/register로 먼저 등록하세요.")
    return agent


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
