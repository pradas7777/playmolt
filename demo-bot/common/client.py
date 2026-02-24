"""
공통 인증 + 챌린지 플로우. 모든 게임 봇이 사용.
"""
import os
import sys
import time
import requests


BASE_URL_DEFAULT = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")
JOIN_TIMEOUT_SEC = 305
DEFAULT_PASSWORD = "testbot_password"


class PlayMoltClient:
    """인증·join·상태·액션·결과 API를 담당하는 공통 클라이언트."""

    def __init__(self, base_url: str, name: str):
        self.base_url = (base_url or BASE_URL_DEFAULT).rstrip("/")
        raw = (name or "").strip() or "bot"
        # 로그/에이전트용 표시 이름 (타임스탬프로 구분)
        self.name = f"{raw}_{int(time.time())}" if raw else f"bot_{int(time.time())}"
        # 회원가입용: username 2~20자, 이메일 허용 도메인 사용 (test.local 불가)
        base = raw[:12]
        suffix = str(int(time.time()))[-6:]
        self._username = (base + "_" + suffix)[:20]
        self._email = f"{self._username}@example.com"
        self._api_key: str | None = None
        self._agent_id: str | None = None

    def _req(
        self,
        method: str,
        path: str,
        step: str,
        json_data: dict | None = None,
        headers: dict | None = None,
        timeout: int = 30,
    ) -> requests.Response:
        url = f"{self.base_url}{path}"
        h = {"Content-Type": "application/json", **(headers or {})}
        if self._api_key:
            h["X-API-Key"] = self._api_key
        try:
            kw = {"headers": h, "timeout": timeout}
            if json_data is not None and method.lower() in ("post", "put", "patch"):
                kw["json"] = json_data
            r = getattr(requests, method.lower())(url, **kw)
            return r
        except Exception as e:
            print(f"[ERROR] 단계={step} 요청 실패 url={url} err={e}", file=sys.stderr)
            raise

    def _raise_if_error(self, r: requests.Response, step: str) -> None:
        if not r.ok:
            print(f"[ERROR] 단계={step} {r.status_code} {r.text}", file=sys.stderr)
            r.raise_for_status()

    def register_and_verify(self, persona: str = "전략적인 AI") -> dict:
        """
        전체 인증 + 챌린지 플로우:
        1. POST /api/auth/register
        2. POST /api/auth/login → access_token
        3. POST /api/auth/api-key → api_key
        4. POST /api/agents/register → agent + challenge
        5. POST /api/agents/challenge → {"answer": "READY", "token": "..."}
        """
        email = self._email
        username = self._username
        password = DEFAULT_PASSWORD

        # 1. register
        r = self._req(
            "post", "/api/auth/register", "register",
            json_data={"email": email, "username": username, "password": password},
        )
        self._raise_if_error(r, "register")

        # 2. login
        r = self._req(
            "post", "/api/auth/login", "login",
            json_data={"email": email, "password": password},
        )
        self._raise_if_error(r, "login")
        token = r.json().get("access_token")
        if not token:
            print("[ERROR] 단계=login access_token 없음", file=sys.stderr)
            raise RuntimeError("login: access_token 없음")

        # 3. api-key
        r = self._req(
            "post", "/api/auth/api-key", "api-key",
            headers={"Authorization": f"Bearer {token}"},
        )
        self._raise_if_error(r, "api-key")
        self._api_key = r.json().get("api_key")
        if not self._api_key:
            print("[ERROR] 단계=api-key api_key 없음", file=sys.stderr)
            raise RuntimeError("api-key: api_key 없음")

        # 4. agents/register
        r = self._req(
            "post", "/api/agents/register", "agents/register",
            json_data={"name": self.name, "persona_prompt": persona},
        )
        self._raise_if_error(r, "agents/register")
        data = r.json()
        self._agent_id = data.get("id")

        # 5. challenge
        challenge = data.get("challenge", {})
        challenge_token = challenge.get("token")
        if challenge_token:
            r = self._req(
                "post", "/api/agents/challenge", "challenge",
                json_data={"answer": "READY", "token": challenge_token},
            )
            self._raise_if_error(r, "challenge")

        return {"agent_id": self._agent_id, "name": self.name}

    def join_game(self, game_type: str) -> str:
        """POST /api/games/join → game_id 반환."""
        r = self._req(
            "post", "/api/games/join", "join",
            json_data={"game_type": game_type},
            timeout=JOIN_TIMEOUT_SEC,
            headers={"Connection": "close"},
        )
        if r.status_code == 408:
            r.raise_for_status()
        if r.status_code == 409:
            print("[ERROR] 단계=join 409 ALREADY_IN_GAME", file=sys.stderr)
            r.raise_for_status()
        self._raise_if_error(r, "join")
        body = r.json()
        return body.get("game_id") or ""

    def get_state(self, game_id: str) -> dict:
        """GET /api/games/{game_id}/state"""
        r = self._req("get", f"/api/games/{game_id}/state", "state")
        self._raise_if_error(r, "state")
        return r.json()

    def submit_action(self, game_id: str, action: dict) -> dict:
        """POST /api/games/{game_id}/action"""
        r = self._req(
            "post", f"/api/games/{game_id}/action", "action",
            json_data=action,
        )
        self._raise_if_error(r, "action")
        return r.json()

    def get_result(self, game_id: str) -> dict:
        """GET /api/games/{game_id}/result"""
        r = self._req("get", f"/api/games/{game_id}/result", "result")
        self._raise_if_error(r, "result")
        return r.json()
