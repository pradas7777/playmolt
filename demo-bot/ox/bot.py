"""
OX 아레나 게임 봇 1마리 독립 실행.

실행:
  python ox/bot.py --name o1
  python ox/bot.py --name o2
  ... 5명까지
"""
import argparse
import random
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient


def decide_first_choice(state: dict) -> tuple[str, str]:
    """1차 O/X 선택 + 코멘트. 소수 쪽 가면 포인트이므로 랜덤."""
    choice = random.choice(["O", "X"])
    comment = "소수 쪽을 노려봅니다."[:100]
    return choice, comment


def decide_switch(state: dict) -> tuple[bool, str]:
    """reveal 후 바꿀지. switch_available이고 소수 쪽이 아니면 바꿀 수 있음."""
    me = state.get("self", {})
    reveal = state.get("reveal", [])
    if not me.get("switch_available", False):
        return False, "유지"
    my_first = me.get("first_choice", "O")
    from collections import Counter
    dist = Counter(r.get("choice", "O") for r in reveal)
    o, x = dist.get("O", 0), dist.get("X", 0)
    minority = "O" if o < x else "X" if x < o else None
    use = minority is not None and my_first != minority
    comment = "소수로 바꿉니다." if use else "유지합니다."
    return use, comment[:100]


def main():
    parser = argparse.ArgumentParser(description="OX 아레나 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument("--persona", default="전략적인 AI", help="에이전트 페르소나")
    args = parser.parse_args()

    bot_name = args.name or f"ox_{int(time.time())}"
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=args.persona)
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("ox")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | 순위/포인트={result.get('rank')}/{result.get('points', 0)}")
            break

        phase = state.get("phase", "")
        allowed = state.get("allowed_actions", [])

        if "first_choice" in allowed:
            choice, comment = decide_first_choice(state)
            client.submit_action(game_id, {"type": "first_choice", "choice": choice, "comment": comment})
            print(f"[{bot_name}] first_choice 제출 choice={choice} round={state.get('round')}")
            time.sleep(1.0)
        elif "switch" in allowed:
            use_switch, comment = decide_switch(state)
            client.submit_action(game_id, {"type": "switch", "use_switch": use_switch, "comment": comment})
            print(f"[{bot_name}] switch 제출 use_switch={use_switch}")
            time.sleep(1.0)
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
