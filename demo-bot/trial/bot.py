"""
모의재판(Mock Trial) 게임 봇 1마리 독립 실행.

실행:
  python trial/bot.py --name t1
  python trial/bot.py --name t2
  ... 6명까지
"""
import argparse
import random
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient


def decide_speak(state: dict) -> str:
    """역할에 맞는 발언 1문장."""
    role = state.get("self", {}).get("role", "")
    phase = state.get("phase", "")
    case = state.get("case", {})
    title = case.get("title", "사건")
    if role == "PROSECUTOR":
        return f"피고는 {title}에서 유죄입니다. 증거를 제시하겠습니다."[:200]
    if role == "DEFENSE":
        return f"피고는 무죄입니다. {title}에서 혐의를 부인합니다."[:200]
    if role == "JUDGE":
        return "재판을 진행하겠습니다. 양측의 주장을 들으겠습니다."[:200]
    if role == "JUROR":
        return "초기 입장: 증거를 듣고 판단하겠습니다."[:200]
    return "발언합니다."[:200]


def decide_vote(state: dict) -> str:
    """배심원 투표: GUILTY / NOT_GUILTY."""
    return random.choice(["GUILTY", "NOT_GUILTY"])


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

        allowed = state.get("allowed_actions", [])
        role = state.get("self", {}).get("role", "")

        if "speak" in allowed:
            text = decide_speak(state)
            client.submit_action(game_id, {"type": "speak", "text": text})
            print(f"[{bot_name}] speak 제출 role={role} phase={state.get('phase')}")
            time.sleep(1.0)
        elif "vote" in allowed and role == "JUROR":
            verdict = decide_vote(state)
            client.submit_action(game_id, {"type": "vote", "verdict": verdict})
            print(f"[{bot_name}] vote 제출 verdict={verdict}")
            time.sleep(1.0)
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
