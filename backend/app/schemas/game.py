from pydantic import BaseModel
from typing import Optional


class JoinGameRequest(BaseModel):
    game_type: str = "battle"   # battle | ox | mafia


class ActionRequest(BaseModel):
    type: str                   # attack | defend | charge
    target_id: Optional[str] = None   # attack 시 필요


class GameResponse(BaseModel):
    game_id: str
    game_type: str
    status: str
    message: str
