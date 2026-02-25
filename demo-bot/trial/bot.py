"""
모의재판(Mock Trial) 게임 봇 1마리 독립 실행.

state의 expected_action만 보고 동작 (pass → 제출 안 함, speak → 발언, vote → 투표).
실행:
  python trial/bot.py --name t1
  python trial/bot.py --name t2
  ... 6명까지
"""
import argparse
import random
import sys
import time

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient


def decide_speak(state: dict) -> str:
    """역할·phase에 맞는 발언 1문장 (최대 200자)."""
    role = state.get("self", {}).get("role", "")
    phase = state.get("phase", "")
    case = state.get("case", {})
    title = case.get("title", "사건")
    if role == "PROSECUTOR":
        if phase == "verdict":
            return "재판장의 평결을 존중합니다."[:200]
        return f"피고는 {title}에서 유죄입니다. 증거를 제시하겠습니다."[:200]
    if role == "DEFENSE":
        if phase == "verdict":
            return "재판장의 평결을 존중합니다."[:200]
        return f"피고는 무죄입니다. {title}에서 혐의를 부인합니다."[:200]
    if role == "JUDGE":
        if phase == "opening":
            return "재판을 진행하겠습니다. 양측의 주장을 들으겠습니다."[:200]
        if phase == "argument":
            return "계속 진행하겠습니다."[:200]
        if phase == "rebuttal":
            return "최후 반론을 들었습니다."[:200]
        if phase == "verdict":
            return "배심원 평결에 따라 판결을 선고합니다. 재판을 마칩니다."[:200]
        return "발언합니다."[:200]
    if role == "JUROR":
        return "증거를 듣고 판단하겠습니다."[:200]
    return "발언합니다."[:200]


def decide_vote(state: dict) -> str:
    """배심원 투표: GUILTY / NOT_GUILTY."""
    return random.choice(["GUILTY", "NOT_GUILTY"])


def submit_action_with_retry(
    client: PlayMoltClient, game_id: str, action: dict, state: dict, bot_name: str
) -> bool:
    """액션 제출. 400 시 ALREADY_ACTED면 대기, 그 외 expected_action 기준으로 1회 재시도."""
    try:
        client.submit_action(game_id, action)
        return True
    except requests.HTTPError as e:
        if e.response.status_code != 400:
            raise
        try:
            body = e.response.json()
            detail = body.get("detail", body) if isinstance(body, dict) else {}
        except Exception:
            detail = {}
        if not isinstance(detail, dict):
            raise
        err = detail.get("error", "")
        expected = detail.get("expected_action", "")
        if err == "ALREADY_ACTED":
            print(f"[{bot_name}] 이미 제출함 (이번 phase) → 대기")
            return False
        # 잘못된 type 보냈을 때 한 번만 올바른 형태로 재시도
        if expected == "vote":
            retry_action = {"type": "vote", "verdict": decide_vote(state)}
            print(f"[{bot_name}] 400 후 재시도 expected_action=vote → {retry_action}")
            client.submit_action(game_id, retry_action)
            return True
        if expected == "speak":
            retry_action = {"type": "speak", "text": decide_speak(state)}
            print(f"[{bot_name}] 400 후 재시도 expected_action=speak")
            client.submit_action(game_id, retry_action)
            return True
        print(f"[{bot_name}] 액션 실패 error={err} expected={expected}", file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description="모의재판 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument("--persona", default="전략적인 AI", help="에이전트 페르소나")
    args = parser.parse_args()

    bot_name = args.name or f"trial_{int(time.time())}"
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=args.persona)
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("trial")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | verdict={result.get('verdict')} 포인트={result.get('points', 0)}")
            break

        expected = state.get("expected_action") or ""
        role = state.get("self", {}).get("role", "")
        phase = state.get("phase", "")

        if expected == "pass" or expected == "":
            time.sleep(0.5)
            continue

        if expected == "speak":
            text = decide_speak(state)
            submit_action_with_retry(client, game_id, {"type": "speak", "text": text}, state, bot_name)
            print(f"[{bot_name}] speak 제출 role={role} phase={phase}")
            time.sleep(1.0)
            continue

        if expected == "vote":
            verdict = decide_vote(state)
            submit_action_with_retry(client, game_id, {"type": "vote", "verdict": verdict}, state, bot_name)
            print(f"[{bot_name}] vote 제출 verdict={verdict}")
            time.sleep(1.0)
            continue

        time.sleep(0.5)


if __name__ == "__main__":
    main()
