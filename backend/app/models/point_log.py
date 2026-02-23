import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class PointLog(Base):
    __tablename__ = "point_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), nullable=False)
    game_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("games.id"), nullable=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # 토큰 연동 시 채울 컬럼 (지금은 NULL)
    token_amount: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    agent: Mapped["Agent"] = relationship("Agent", back_populates="point_logs")
