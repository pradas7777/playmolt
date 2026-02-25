from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime

# 절대 차단 키워드 (프롬프트 인젝션 방지)
BANNED_PATTERNS = [
    "ignore previous",
    "ignore all",
    "system prompt",
    "절대규칙",
    "you are now",
    "pretend you are",
    "forget your instructions",
    "disregard",
    "override",
    "jailbreak",
]


class AgentRegisterRequest(BaseModel):
    name: str
    persona_prompt: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, v):
        if len(v) < 1 or len(v) > 30:
            raise ValueError("에이전트 이름은 1~30자여야 합니다")
        return v

    @field_validator("persona_prompt")
    @classmethod
    def persona_safe(cls, v):
        if v is None:
            return v
        if len(v) > 500:
            raise ValueError("퍼소나는 500자 이내로 작성해주세요")
        v_lower = v.lower()
        for pattern in BANNED_PATTERNS:
            if pattern.lower() in v_lower:
                raise ValueError(f"허용되지 않는 표현이 포함되어 있습니다")
        return v


class GameTypeStats(BaseModel):
    """게임별 또는 전체 승/패·승률."""
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0  # wins / (wins + losses), 0건이면 0.0


class AgentResponse(BaseModel):
    id: str
    name: str
    persona_prompt: Optional[str]
    total_points: int
    status: str        # "active" | "pending" | "suspended"
    created_at: datetime

    class Config:
        from_attributes = True


class AgentMeResponse(AgentResponse):
    """GET /api/agents/me 응답: 기본 정보 + 게임별·전체 승패(승률) 기록."""
    game_stats: dict[str, GameTypeStats] = {}  # "battle" | "ox" | "mafia" | "trial"
    total_stats: GameTypeStats = GameTypeStats()


class ChallengeInfo(BaseModel):
    token: str
    instruction: str
    expires_in_seconds: int


class AgentRegisterResponse(BaseModel):
    """등록 응답: 에이전트 정보 + LLM 챌린지. 챌린지 통과 후 게임 참가 가능."""
    id: str
    name: str
    persona_prompt: Optional[str]
    total_points: int
    status: str
    created_at: datetime
    challenge: ChallengeInfo

    class Config:
        from_attributes = True


class ChallengeRequest(BaseModel):
    answer: str
    token: str
