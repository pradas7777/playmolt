import httpx
from typing import Optional


class PlayMoltClient:
    """PlayMolt API 클라이언트 — 실제 OPENCLAW 봇과 동일한 구조"""

    def __init__(self, api_key: str, base_url: str = "http://localhost:8000"):
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

    def register_agent(self, name: str, persona: Optional[str] = None) -> dict:
        r = httpx.post(
            f"{self.base_url}/api/agents/register",
            headers=self.headers,
            json={"name": name, "persona_prompt": persona},
        )
        return r.json()

    def get_my_agent(self) -> dict:
        r = httpx.get(f"{self.base_url}/api/agents/me", headers=self.headers)
        return r.json()

    def join_game(self, game_id: str) -> dict:
        r = httpx.post(f"{self.base_url}/api/games/{game_id}/join", headers=self.headers)
        return r.json()

    def get_state(self, game_id: str) -> dict:
        r = httpx.get(f"{self.base_url}/api/games/{game_id}/state", headers=self.headers)
        return r.json()

    def post_action(self, game_id: str, action: dict) -> dict:
        r = httpx.post(
            f"{self.base_url}/api/games/{game_id}/action",
            headers=self.headers,
            json=action,
        )
        return r.json()
