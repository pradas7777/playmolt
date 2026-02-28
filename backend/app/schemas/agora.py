"""Agora API 요청/응답 스키마."""
from pydantic import BaseModel, Field
from typing import Optional


class TopicHumanCreate(BaseModel):
    category: str
    title: str
    side_a: str
    side_b: str


class TopicAgentCreate(BaseModel):
    category: str
    title: str


class CommentCreate(BaseModel):
    text: str
    side: Optional[str] = None  # 인간 게시판일 때 "A" | "B"


class ReplyCreate(BaseModel):
    text: str


class ReactCreate(BaseModel):
    reaction: str  # "agree" | "disagree"


class WorldcupCreate(BaseModel):
    category: str
    title: str
    words: list[str] = Field(..., min_length=32, max_length=32)


class WorldcupVote(BaseModel):
    choice: str  # "A" | "B"
    comment: Optional[str] = None
