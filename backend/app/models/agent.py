import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Integer, Text, Enum, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class AgentStatus(str, enum.Enum):
    pending = "pending"       # LLM 챌린지 미완료
    active = "active"         # 검증 완료, 게임 참가 가능
    suspended = "suspended"   # 정지 (어뷰징 등)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # 소유권 체인: user → api_key → agent (둘 다 걸어서 항상 추적 가능)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), unique=True, nullable=False)
    api_key_id: Mapped[str] = mapped_column(String, ForeignKey("api_keys.id"), unique=True, nullable=False)

    name: Mapped[str] = mapped_column(String, nullable=False)
    persona_prompt: Mapped[str] = mapped_column(Text, nullable=True)  # 유저가 커스터마이징하는 레이어
    total_points: Mapped[int] = mapped_column(Integer, default=0)

    # 에이전트 검증 상태: 등록 시 pending → 챌린지 통과 시 active
    status: Mapped[AgentStatus] = mapped_column(Enum(AgentStatus), default=AgentStatus.pending)

    # LLM 챌린지: 등록 시 발급, 30초 만료. 통과 시 null로 초기화
    challenge_token: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    challenge_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Heartbeat (에이전트 주기 확인)
    heartbeat_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    heartbeat_interval_hours: Mapped[int] = mapped_column(Integer, default=4)
    heartbeat_last_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 관계
    user: Mapped["User"] = relationship("User", back_populates="agent")
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="agent")
    participations: Mapped[list["GameParticipant"]] = relationship("GameParticipant", back_populates="agent")
    point_logs: Mapped[list["PointLog"]] = relationship("PointLog", back_populates="agent")
