"""
룰 기반 테스트 봇 — 4개 봇이 실제 서버에 붙어 배틀 1판 완주.
LLM 없이 BattleStrategy.decide_action(state)로 액션 결정.
실행: 서버(localhost:8000) 띄운 뒤  cd demo-bot && python test_run.py
"""
import os
import sys
import time
import threading
from typing import Any

import requests

# BASE_URL: 환경변수 PLAYMOLT_URL 또는 기본값
BASE_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")

# 실행 시점 고유 접미사 (재실행 시 유저 중복 409 방지)
suffix = int(time.time())
BOT_NAMES = [f"testbot_{i}_{suffix}" for i in range(4)]
BOT_EMAILS = [f"testbot_{i}_{suffix}@test.com" for i in range(4)]
PASSWORD = "testbot_password"

GAME_ID_KEY = "game_id"
ROUND_LOCK = threading.Lock()
LAST_ROUND_PRINTED = -1
RESULTS_LIST: list[tuple[str, dict]] = []


def _req(method: str, path: str, bot_name: str, step: str, **kwargs) -> requests.Response:
    """요청 실행, 실패 시 봇명·단계 출력 후 예외."""
    url = f"{BASE_URL.rstrip('/')}{path}"
    try:
        r = getattr(requests, method.lower())(url, timeout=30, **kwargs)
        return r
    except Exception as e:
        print(f"[에러] 봇={bot_name} 단계={step} url={url} err={e}", file=sys.stderr)
        raise


def _raise_if_error(r: requests.Response, bot_name: str = "", step: str = "") -> None:
    """응답이 실패면 상태코드/URL/응답본문 출력 후 raise_for_status()."""
    if not r.ok:
        print(f"[ERROR] 봇={bot_name} 단계={step} {r.status_code} {r.url}", file=sys.stderr)
        print(f"  응답: {r.text}", file=sys.stderr)
        r.raise_for_status()


def run_bot(bot_index: int, shared: dict[str, Any]) -> None:
    """한 봇의 전체 플로우: 유저 생성 → 로그인 → API Key → 에이전트 등록 → 참가 → 게임 루프."""
    global LAST_ROUND_PRINTED, RESULTS_LIST
    name = BOT_NAMES[bot_index]
    email = BOT_EMAILS[bot_index]
    step = "register"

    # 1. POST /api/auth/register
    r = _req("post", "/api/auth/register", name, step, json={
        "email": email,
        "username": name,
        "password": PASSWORD,
    })
    _raise_if_error(r, name, step)
    step = "login"

    # 2. POST /api/auth/login
    r = _req("post", "/api/auth/login", name, step, json={"email": email, "password": PASSWORD})
    _raise_if_error(r, name, step)
    token = r.json()["access_token"]
    step = "api-key"

    # 3. POST /api/auth/api-key
    r = _req("post", "/api/auth/api-key", name, step, headers={"Authorization": f"Bearer {token}"})
    _raise_if_error(r, name, step)
    api_key = r.json()["api_key"]
    step = "agents/register"

    # 4. POST /api/agents/register
    r = _req("post", "/api/agents/register", name, step, headers={
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }, json={"name": name})
    _raise_if_error(r, name, step)
    step = "games/join"

    # 5. POST /api/games/join
    r = _req("post", "/api/games/join", name, step, headers={
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }, json={"game_type": "battle"})
    _raise_if_error(r, name, step)
    data = r.json()
    game_id = data["game_id"]
    shared[GAME_ID_KEY] = game_id

    # 6. 게임 루프
    from strategies.battle_strategy import BattleStrategy
    strategy = BattleStrategy()
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    last_acted_round = -1  # 같은 라운드에 두 번 제출해 ALREADY_ACTED 나는 것 방지

    while True:
        r = _req("get", f"/api/games/{game_id}/state", name, "state", headers=headers)
        _raise_if_error(r, name, "state")
        state = r.json()

        status = state.get("gameStatus")
        phase = state.get("phase", "")
        current_round = int(state.get("round", 0))

        if status == "finished":
            result = state.get("result") or {}
            shared["final_round"] = state.get("round", 0)
            with ROUND_LOCK:
                RESULTS_LIST.append((name, result))
                if len(RESULTS_LIST) == 4:
                    _print_final(shared.get(GAME_ID_KEY, game_id), shared.get("final_round", 0))
            break

        if phase == "collect" and current_round != last_acted_round:
            _maybe_print_round(state)
            action = strategy.decide_action(state)
            print(f"[action] 봇={name} 제출 전 action={action}", file=sys.stderr)
            r = _req("post", f"/api/games/{game_id}/action", name, "action", headers=headers, json=action)
            _raise_if_error(r, name, "action")
            last_acted_round = current_round
            print(f"[action] 봇={name} 제출 후 응답 ok (round={current_round})", file=sys.stderr)
            # 서버가 라운드 적용할 시간 확보 후 바깥 루프에서 다시 state 조회
            time.sleep(1.2)
        else:
            # collect가 아니거나 이미 이 라운드 제출함 → 다음 state 올 때까지 대기
            print(f"[대기] 봇={name} round={current_round} phase={phase} last_acted={last_acted_round}", file=sys.stderr)
            time.sleep(0.5)


def _maybe_print_round(state: dict) -> None:
    """라운드마다 한 번만 round / 각 에이전트 HP/energy 출력."""
    global LAST_ROUND_PRINTED
    round_num = state.get("round", 0)
    phase = state.get("phase", "")
    with ROUND_LOCK:
        if phase != "collect" or round_num <= LAST_ROUND_PRINTED:
            return
        LAST_ROUND_PRINTED = round_num

    me = state.get("self", {})
    others = state.get("other_agents", [])
    lines = [f"  [Round {round_num}] self: hp={me.get('hp')} energy={me.get('energy')}"]
    for o in others:
        lines.append(f"    agent {str(o.get('id', ''))[:8]}...: hp={o.get('hp')} energy={o.get('energy')} alive={o.get('alive')}")
    print("\n".join(lines))


def _print_final(game_id: str, total_rounds: int = 0) -> None:
    """게임 종료 시 winner, 총 라운드 수, 각 봇 포인트 출력."""
    print(f"\n[게임 종료] game_id={game_id} 총_라운드={total_rounds}")
    winner_name = None
    for name, result in RESULTS_LIST:
        pts = result.get("points", 0)
        is_winner = result.get("isWinner", False)
        if is_winner:
            winner_name = name
        print(f"  {name}: points={pts} isWinner={is_winner}")
    print(f"  winner: {winner_name}")


def main() -> None:
    print(f"BASE_URL={BASE_URL}  봇 4개 동시 실행 (배틀 1판)")
    shared: dict[str, Any] = {}
    threads = [
        threading.Thread(target=run_bot, args=(i, shared), name=f"bot-{i}")
        for i in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print("테스트 봇 실행 완료.")


if __name__ == "__main__":
    main()
