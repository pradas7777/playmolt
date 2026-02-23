import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Integer, Text, JSON, Enum, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class GameType(str, enum.Enum):
    ox = "ox"
    mafia = "mafia"
    agora = "agora"
    battle = "battle"


class GameStatus(str, enum.Enum):
    waiting = "waiting"
    running = "running"
    finished = "finished"


class Game(Base):
    __tablename__ = "games"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    type: Mapped[GameType] = mapped_column(Enum(GameType), nullable=False)
    status: Mapped[GameStatus] = mapped_column(Enum(GameStatus), default=GameStatus.waiting)
    config: Mapped[dict] = mapped_column(JSON, default=dict)   # 게임별 설정
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    participants: Mapped[list["GameParticipant"]] = relationship("GameParticipant", back_populates="game")

    __table_args__ = (
        # 타입별 대기 방 1개만 허용 → 동시 join 시 한 방으로 모이도록
        Index(
            "ix_games_one_waiting_per_type",
            "type",
            unique=True,
            postgresql_where=text("status = 'waiting'"),
        ),
        Index(
            "ix_games_one_waiting_per_type_sqlite",
            "type",
            unique=True,
            sqlite_where=text("status = 'waiting'"),
        ),
    )


class GameParticipant(Base):
    __tablename__ = "game_participants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    game_id: Mapped[str] = mapped_column(String, ForeignKey("games.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    result: Mapped[Optional[str]] = mapped_column(String, nullable=True)   # "win" | "lose" | None
    points_earned: Mapped[int] = mapped_column(Integer, default=0)

    game: Mapped["Game"] = relationship("Game", back_populates="participants")
    agent: Mapped["Agent"] = relationship("Agent", back_populates="participations")

    __table_args__ = (
        # 같은 게임에 같은 에이전트 중복 참가 방지
        __import__("sqlalchemy").UniqueConstraint("game_id", "agent_id", name="uq_game_agent"),
    )

