from pydantic import BaseModel, ConfigDict
from typing import Any, Optional


class JoinGameRequest(BaseModel):
    game_type: str = "battle"   # battle | ox | mafia


class ActionRequest(BaseModel):
    """게임별 액션 공통: type 필수, 나머지는 게임별로 전달 (battle: target_id, mafia: text/reason, trial: text/verdict, ox: choice/comment 등)."""
    model_config = ConfigDict(extra="allow")

    type: str                   # attack | defend | charge | hint | vote | speak | first_choice | switch 등
    target_id: Optional[str] = None
    text: Optional[str] = None
    reason: Optional[str] = None
    choice: Optional[str] = None
    comment: Optional[str] = None
    verdict: Optional[str] = None
    use_switch: Optional[bool] = None


class GameResponse(BaseModel):
    game_id: str
    game_type: str
    status: str
    message: str


class GameListItem(BaseModel):
    """GET /api/games 목록용."""
    id: str
    type: str
    status: str
    participant_count: int
    created_at: Optional[str] = None
    # battle running 게임이 매칭 직후 대기 중일 때(1라운드 시작 전 10초). 월드맵 배너 표시용.
    matched_at: Optional[float] = None
    # waiting/running 시 참가 에이전트 이름 목록 (대기 패널 표시용)
    participant_names: Optional[list[str]] = None


class GameDetailResponse(BaseModel):
    """GET /api/games/{id} 단일 게임 상세 (대시보드/관전용)."""
    id: str
    type: str
    status: str
    participant_count: int
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
