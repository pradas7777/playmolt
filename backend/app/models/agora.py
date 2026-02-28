"""
Agora 게시판·월드컵 모델.
- AgoraTopic: 인간/에이전트 게시판 토픽, 월드컵용 토픽
- AgoraComment: 댓글/대댓글 (depth 0 or 1)
- AgoraReaction: 공감/반박 (comment당 agent당 1회)
- AgoraWorldcup: 월드컵 메타
- AgoraMatch: 월드컵 경기 (32/16/8/4/2)
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Integer, Text, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.utf8json import Utf8JsonType

# SQLite 한글 등 저장 시 인코딩 깨짐 방지
ArchiveJSON = JSON().with_variant(Utf8JsonType(), "sqlite")

# 카테고리/보드 상수
CATEGORIES = ("자유", "과학&기술", "예술&문화", "정치&경제", "시사&연예")
BOARDS = ("human", "agent", "worldcup")


class AgoraTopic(Base):
    __tablename__ = "agora_topics"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    board: Mapped[str] = mapped_column(String, nullable=False)  # "human" | "agent" | "worldcup"
    category: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    side_a: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 인간 게시판만
    side_b: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 인간 게시판만
    author_type: Mapped[str] = mapped_column(String, nullable=False)  # "human" | "agent"
    author_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active")  # "active" | "archived"
    temperature: Mapped[int] = mapped_column(Integer, default=0)  # 활성 에이전트 수
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    comments: Mapped[list["AgoraComment"]] = relationship(
        "AgoraComment", back_populates="topic", foreign_keys="AgoraComment.topic_id"
    )


class AgoraComment(Base):
    __tablename__ = "agora_comments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    topic_id: Mapped[str] = mapped_column(String, ForeignKey("agora_topics.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("agora_comments.id"), nullable=True
    )
    depth: Mapped[int] = mapped_column(Integer, default=0)  # 0=댓글, 1=대댓글, max=1
    side: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "A" | "B" | None
    text: Mapped[str] = mapped_column(Text, nullable=False)
    agree_count: Mapped[int] = mapped_column(Integer, default=0)
    disagree_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    topic: Mapped["AgoraTopic"] = relationship(
        "AgoraTopic", back_populates="comments", foreign_keys=[topic_id]
    )
    parent: Mapped[Optional["AgoraComment"]] = relationship(
        "AgoraComment", remote_side="AgoraComment.id", foreign_keys=[parent_id]
    )
    replies: Mapped[list["AgoraComment"]] = relationship(
        "AgoraComment", back_populates="parent", foreign_keys=[parent_id]
    )


class AgoraReaction(Base):
    __tablename__ = "agora_reactions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    comment_id: Mapped[str] = mapped_column(
        String, ForeignKey("agora_comments.id"), nullable=False
    )
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), nullable=False)
    reaction: Mapped[str] = mapped_column(String, nullable=False)  # "agree" | "disagree"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (UniqueConstraint("comment_id", "agent_id", name="uq_agora_reaction_comment_agent"),)


class AgoraWorldcup(Base):
    __tablename__ = "agora_worldcups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    topic_id: Mapped[str] = mapped_column(String, ForeignKey("agora_topics.id"), nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, default="round_32"
    )  # round_32|round_16|round_8|round_4|final|archived
    archive: Mapped[dict] = mapped_column(ArchiveJSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    topic: Mapped["AgoraTopic"] = relationship("AgoraTopic", foreign_keys=[topic_id])
    matches: Mapped[list["AgoraMatch"]] = relationship(
        "AgoraMatch", back_populates="worldcup", foreign_keys="AgoraMatch.worldcup_id"
    )


class AgoraMatch(Base):
    __tablename__ = "agora_matches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    worldcup_id: Mapped[str] = mapped_column(
        String, ForeignKey("agora_worldcups.id"), nullable=False
    )
    round: Mapped[int] = mapped_column(Integer, nullable=False)  # 32|16|8|4|2
    side_a: Mapped[str] = mapped_column(String, nullable=False)
    side_b: Mapped[str] = mapped_column(String, nullable=False)
    agree_count: Mapped[int] = mapped_column(Integer, default=0)
    disagree_count: Mapped[int] = mapped_column(Integer, default=0)
    winner: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "A" | "B" | None
    closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    worldcup: Mapped["AgoraWorldcup"] = relationship(
        "AgoraWorldcup", back_populates="matches", foreign_keys=[worldcup_id]
    )


class AgoraMatchVote(Base):
    """월드컵 경기당 에이전트 1회 투표 제한."""
    __tablename__ = "agora_match_votes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    match_id: Mapped[str] = mapped_column(String, ForeignKey("agora_matches.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), nullable=False)
    choice: Mapped[str] = mapped_column(String, nullable=False)  # "A" | "B"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (UniqueConstraint("match_id", "agent_id", name="uq_agora_match_vote"),)
