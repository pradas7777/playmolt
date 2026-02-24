import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests

BASE_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")
TARGET_BOT_COUNT = 4
PASSWORD = "testbot_password"
# 서버 대기열에서 4명 될 때까지 대기할 수 있도록 join 타임아웃은 서버(300초)보다 약간 길게
JOIN_TIMEOUT_SEC = 305
# join 결과 수집: 완료된 것만 먼저 모아서 매칭된 봇이 곧바로 게임 루프 진입하도록. 이 시간(초) 지나면 수집 종료.
JOIN_COLLECT_DEADLINE_SEC = 12

ROUND_LOCK = threading.Lock()
LAST_ROUND_PRINTED = -1
RESULTS_LIST: list[tuple[str, dict]] = []


def _req(method: str, path: str, bot_name: str, step: str, timeout: int = 30, **kwargs) -> requests.Response:
    url = f"{BASE_URL.rstrip('/')}{path}"
    try:
        return getattr(requests, method.lower())(url, timeout=timeout, **kwargs)
    except Exception as e:
        print(f"[error] bot={bot_name} step={step} url={url} err={e}", file=sys.stderr)
        raise


def _raise_if_error(r: requests.Response, bot_name: str = "", step: str = "") -> None:
    if not r.ok:
        print(f"[ERROR] bot={bot_name} step={step} {r.status_code} {r.url}", file=sys.stderr)
        print(f"  response: {r.text}", file=sys.stderr)
        r.raise_for_status()


def _create_identity(seq: int) -> tuple[str, str]:
    ts = int(time.time() * 1000) % 1000000
    rnd = random.randint(100, 999)
    name = f"tb{seq}_{ts}_{rnd}"
    email = f"{name}@test.com"
    return name, email


def _bootstrap_one(seq: int) -> dict[str, Any]:
    """에이전트 1명 등록만 (register, login, api-key, agents/register). 병렬 호출용."""
    name, email = _create_identity(seq)

    r = _req("post", "/api/auth/register", name, "register", json={
        "email": email,
        "username": name,
        "password": PASSWORD,
    })
    _raise_if_error(r, name, "register")

    r = _req("post", "/api/auth/login", name, "login", json={
        "email": email,
        "password": PASSWORD,
    })
    _raise_if_error(r, name, "login")
    token = r.json()["access_token"]

    r = _req("post", "/api/auth/api-key", name, "api-key", headers={
        "Authorization": f"Bearer {token}",
    })
    _raise_if_error(r, name, "api-key")
    api_key = r.json()["api_key"]

    r = _req("post", "/api/agents/register", name, "agents/register", headers={
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }, json={"name": name})
    _raise_if_error(r, name, "agents/register")
    # test_run 전용: 챌린지 통과 → status active (게임 join 가능)
    data = r.json()
    challenge_token = data.get("challenge", {}).get("token")
    if challenge_token:
        r = _req("post", "/api/agents/challenge", name, "agents/challenge", headers={
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }, json={"answer": "READY", "token": challenge_token})
        _raise_if_error(r, name, "agents/challenge")

    return {
        "name": name,
        "email": email,
        "api_key": api_key,
        "game_id": "",  # join 후 채움
        "active": True,
    }


def _join_one(bot: dict[str, Any]) -> str:
    """대기열 join. 4명 될 때까지 서버에서 대기하므로 타임아웃 길게."""
    name = bot["name"]
    sys.stderr.write(f"[join] {name} 요청 전송\n")
    sys.stderr.flush()
    # Connection: close로 요청별 연결 분리 → 4개 응답이 서로 다른 소켓에 섞이지 않도록
    r = _req(
        "post", "/api/games/join", name, "games/join",
        timeout=JOIN_TIMEOUT_SEC,
        headers={
            "X-API-Key": bot["api_key"],
            "Content-Type": "application/json",
            "Connection": "close",
        },
        json={"game_type": "battle"},
    )
    sys.stderr.write(f"[join] {name} 응답 수신 status={r.status_code}\n")
    sys.stderr.flush()
    if r.status_code == 408:
        raise RuntimeError(f"{name}: 매칭 대기 시간 초과")
    if r.status_code == 409:
        # 이미 진행 중인 게임 있음 (서버가 game_id를 더 이상 넘기지 않음 → 잘못된 게임 진입 방지)
        raise RuntimeError(f"{name}: 이미 진행 중인 게임 있음(ALREADY_IN_GAME)")
    _raise_if_error(r, name, "games/join")
    return r.json()["game_id"]


def run_bot(bot: dict[str, Any], shared: dict[str, Any]) -> None:
    global LAST_ROUND_PRINTED, RESULTS_LIST

    name = bot["name"]
    game_id = bot["game_id"]
    headers = {"X-API-Key": bot["api_key"], "Content-Type": "application/json"}
    print(f"[run_bot] 시작 name={name} game_id={game_id[:8] if game_id else ''}...", file=sys.stderr)

    from strategies.battle_strategy import BattleStrategy
    strategy = BattleStrategy()

    last_acted_round = -1
    waiting_since: float | None = None
    waiting_timeout = 30.0
    poll_count = 0

    while True:
        poll_count += 1
        r = _req("get", f"/api/games/{game_id}/state", name, "state", headers=headers)
        if r.status_code == 403:
            with ROUND_LOCK:
                RESULTS_LIST.append((name, {"points": 0, "isWinner": False, "did_not_join": True}))
                if len(RESULTS_LIST) == shared.get("ready_count", TARGET_BOT_COUNT):
                    _print_final(game_id, shared.get("final_round", 0))
            break
        _raise_if_error(r, name, "state")
        state = r.json()

        status = state.get("gameStatus")
        phase = state.get("phase", "")
        current_round = int(state.get("round", 0))
        # 3명만 매칭된 경우 등에서 액션 제출이 되는지 확인용: 처음 몇 번과 주기적으로 phase/round 출력
        if poll_count <= 3 or poll_count % 20 == 0:
            print(f"[poll] bot={name} gameStatus={status} phase={phase} round={current_round} last_acted={last_acted_round}", file=sys.stderr)

        if phase == "waiting" and status != "finished":
            if waiting_since is None:
                waiting_since = time.monotonic()
            elif time.monotonic() - waiting_since >= waiting_timeout:
                with ROUND_LOCK:
                    RESULTS_LIST.append((name, {"points": 0, "isWinner": False, "waiting_timeout": True}))
                    if len(RESULTS_LIST) == shared.get("ready_count", TARGET_BOT_COUNT):
                        _print_final(game_id, shared.get("final_round", 0))
                break
        else:
            waiting_since = None

        if status == "finished":
            result = state.get("result") or {}
            shared["final_round"] = state.get("round", 0)
            with ROUND_LOCK:
                RESULTS_LIST.append((name, result))
                if len(RESULTS_LIST) == shared.get("ready_count", TARGET_BOT_COUNT):
                    _print_final(game_id, shared.get("final_round", 0))
            break

        am_alive = state.get("self", {}).get("isAlive", True)
        if status == "running" and not am_alive:
            time.sleep(0.5)
            continue

        if phase == "collect" and current_round != last_acted_round:
            _maybe_print_round(state)
            try:
                action = strategy.decide_action(state)
                if not action or not isinstance(action, dict):
                    action = {"type": "charge"}
            except Exception as e:
                print(f"[WARN] bot={name} strategy error round={current_round} ({e}), use charge", file=sys.stderr)
                action = {"type": "charge"}
            if action.get("type") == "attack" and not action.get("target_id"):
                action = {"type": "charge"}
            r = _req("post", f"/api/games/{game_id}/action", name, "action", headers=headers, json=action)
            if r.status_code == 400:
                # INVALID_TARGET 등: 상태가 갱신되어 타깃이 이미 죽었을 수 있음 → charge로 재시도
                err = (r.json() or {}).get("detail", r.text)
                print(f"[WARN] bot={name} action 400 ({err}), retry with charge", file=sys.stderr)
                r = _req("post", f"/api/games/{game_id}/action", name, "action", headers=headers, json={"type": "charge"})
            _raise_if_error(r, name, "action")
            last_acted_round = current_round
            time.sleep(1.0)
        else:
            time.sleep(0.5)


def _maybe_print_round(state: dict) -> None:
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
        lines.append(
            f"    agent {str(o.get('id', ''))[:8]}...: hp={o.get('hp')} "
            f"energy={o.get('energy')} alive={o.get('alive')}"
        )
    print("\n".join(lines))


def _print_final(game_id: str, total_rounds: int = 0) -> None:
    print(f"\n[game finished] game_id={game_id} total_rounds={total_rounds}")
    winner_name = None
    for name, result in RESULTS_LIST:
        if result.get("did_not_join"):
            print(f"  {name}: did_not_join")
            continue
        if result.get("waiting_timeout"):
            print(f"  {name}: waiting_timeout")
            continue
        pts = result.get("points", 0)
        is_winner = result.get("isWinner", False)
        if is_winner:
            winner_name = name
        print(f"  {name}: points={pts} isWinner={is_winner}")
    print(f"  winner: {winner_name}")


def main() -> None:
    print(f"BASE_URL={BASE_URL}")

    # 1) 에이전트 4명 병렬 등록
    print("[1/2] 에이전트 등록 중 (병렬)...")
    bots: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=TARGET_BOT_COUNT) as ex:
        futures = [ex.submit(_bootstrap_one, seq) for seq in range(TARGET_BOT_COUNT)]
        for f in as_completed(futures):
            bots.append(f.result())
    bots.sort(key=lambda b: b["name"])
    print(f"  등록 완료: {[b['name'] for b in bots]}")

    # 2) 대기열 join: 선착순이므로 외부 에이전트가 이미 대기 중이면 그 다음으로 들어가도록
    #    짧은 간격(0.5초)으로 순차 전송. 5명이면 4명만 방에 들어가고 한 명은 대기(또는 408).
    #    ※ 서버가 멀티 워커면 큐가 워커별로 갈라져 외부와 매칭 안 될 수 있음 → 단일 워커 권장.
    # 서버 연결 확인 (join에서 무한 대기 방지)
    try:
        r = requests.get(f"{BASE_URL.rstrip('/')}/docs", timeout=3)
    except Exception as e:
        print(f"[ERROR] 서버 연결 실패 (BASE_URL={BASE_URL}): {e}", file=sys.stderr, flush=True)
        raise RuntimeError("서버에 연결할 수 없습니다. 백엔드를 먼저 실행하세요.") from e
    print("[2/2] 게임 대기열 join 중 (순차 전송으로 대기열 순서 유지)...", flush=True)
    join_futures = []
    with ThreadPoolExecutor(max_workers=TARGET_BOT_COUNT) as ex:
        for i, bot in enumerate(bots):
            if i > 0:
                time.sleep(0.5)
            join_futures.append(ex.submit(_join_one, bot))
            print(f"  join 전송 #{i+1}: {bot['name']}", flush=True)
    print(f"  join 응답 대기 중 (최대 {JOIN_COLLECT_DEADLINE_SEC}초)...", flush=True)
    # 완료된 join부터 수집. 3명 모이면 1초만 더 기다려 4번째 있으면 넣고, 곧바로 게임 루프 시작 (4번째 봇에서 블로킹 방지)
    future_to_bot = {jf: bot for bot, jf in zip(bots, join_futures)}
    ready_bots = []
    processed_futures = set()
    try:
        for jf in as_completed(future_to_bot.keys(), timeout=JOIN_COLLECT_DEADLINE_SEC):
            processed_futures.add(jf)
            bot = future_to_bot[jf]
            try:
                game_id_val = jf.result(timeout=0)
                bot["game_id"] = game_id_val or ""
                if bot["game_id"]:
                    ready_bots.append(bot)
                    print(f"[join] {bot['name']} 매칭 완료 game_id={game_id_val[:8]}...", file=sys.stderr, flush=True)
            except RuntimeError as e:
                if "매칭 대기 시간 초과" in str(e):
                    print(f"[WARN] {bot['name']}: 매칭 타임아웃(408), 스킵", file=sys.stderr)
                elif "ALREADY_IN_GAME" in str(e) or "이미 진행 중인 게임" in str(e):
                    print(f"[WARN] {bot['name']}: 이미 진행 중인 게임 있음(409), 스킵", file=sys.stderr)
                else:
                    raise
            # 3명 모였으면 4번째가 올 때까지 짧게만 대기 후 게임 루프 시작
            if len(ready_bots) >= 3:
                remaining = [f for f in future_to_bot if f not in processed_futures]
                if remaining:
                    try:
                        for jf2 in as_completed(remaining, timeout=1):
                            processed_futures.add(jf2)
                            bot2 = future_to_bot[jf2]
                            try:
                                gid = jf2.result(timeout=0)
                                bot2["game_id"] = gid or ""
                                if bot2["game_id"]:
                                    ready_bots.append(bot2)
                            except RuntimeError:
                                pass
                    except TimeoutError:
                        pass
                print(f"[ready] 매칭 완료 {len(ready_bots)}명 → 게임 루프 즉시 시작", file=sys.stderr)
                break
    except TimeoutError:
        print(f"[WARN] join 응답 대기 타임아웃({JOIN_COLLECT_DEADLINE_SEC}초). 완료된 것만 사용.", file=sys.stderr, flush=True)
        for bot in bots:
            if bot not in ready_bots:
                bot["game_id"] = ""
        if len(ready_bots) < len(bots):
            print(f"[WARN] 일부 봇은 join 미완료(대기열 5번째 등). 매칭된 {len(ready_bots)}명만 게임 루프 진입.", file=sys.stderr, flush=True)
    if not ready_bots:
        raise RuntimeError("모든 봇이 매칭에 실패했습니다.")
    game_id = ready_bots[0]["game_id"]
    print(f"[ready] game_id={game_id} 참가 봇={len(ready_bots)}명 {[b['name'] for b in ready_bots]}")

    shared: dict[str, Any] = {"final_round": 0, "ready_count": len(ready_bots)}
    # 매칭된 봇만 게임 루프 실행 (408으로 참가 못한 봇은 폴링하지 않음)
    threads = [
        threading.Thread(target=run_bot, args=(bot, shared), name=bot["name"])
        for bot in ready_bots
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print("test run completed.")


if __name__ == "__main__":
    main()
