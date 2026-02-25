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
