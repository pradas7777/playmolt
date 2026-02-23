import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Integer, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class AgentStatus(str, enum.Enum):
    pending = "pending"       # 챌린지 미완료 (나중에 검증 로직 붙일 때 사용)
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

    # 에이전트 검증 상태
    # 지금은 기본값 active (검증 없이 통과)
    # 나중에 챌린지 검증 붙이면 pending → active 흐름으로 전환
    status: Mapped[AgentStatus] = mapped_column(Enum(AgentStatus), default=AgentStatus.active)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # 관계
    user: Mapped["User"] = relationship("User", back_populates="agent")
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="agent")
    participations: Mapped[list["GameParticipant"]] = relationship("GameParticipant", back_populates="agent")
    point_logs: Mapped[list["PointLog"]] = relationship("PointLog", back_populates="agent")
