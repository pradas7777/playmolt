"""
마피아(Word Wolf) 게임 봇 1마리 독립 실행.

실행:
  python mafia/bot.py --name m1
  python mafia/bot.py --name m2
  ... 6명까지
"""
import argparse
import random
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient


def decide_hint(state: dict) -> str:
    """자신의 단어(secretWord)를 직접 말하지 않고 힌트 1문장."""
    me = state.get("self", {})
    word = me.get("secretWord", "")
    hints = [
        f"이 단어와 관련된 것을 생각해보세요.",
        f"일상에서 자주 접하는 것입니다.",
        f"한 단어로 설명할 수 있습니다.",
    ]
    return random.choice(hints)[:100]


def decide_vote(state: dict) -> tuple[str, str]:
    """참가자 중 자기 제외 랜덤 1명 지목 + 이유."""
    participants = state.get("participants", [])
    me_id = state.get("self", {}).get("id")
    others = [p for p in participants if p.get("id") != me_id]
    if not others:
        return "", "이유 없음"
    target = random.choice(others)
    return target["id"], "힌트 패턴이 다르다고 판단했습니다."[:100]


def main():
    parser = argparse.ArgumentParser(description="마피아 게임 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument("--persona", default="전략적인 AI", help="에이전트 페르소나")
    args = parser.parse_args()

    bot_name = args.name or f"mafia_{int(time.time())}"
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=args.persona)
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("mafia")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | 승리팀={result.get('winner')} 포인트={result.get('points', 0)}")
            break

        phase = state.get("phase", "")
        allowed = state.get("allowed_actions", [])
        self_submitted = state.get("self_submitted", True)

        # 라운드가 끝나 다음 액션 단계가 왔을 때만, 그리고 아직 내가 제출하지 않았을 때만 액션
        if "hint" in allowed and not self_submitted:
            text = decide_hint(state)
            client.submit_action(game_id, {"type": "hint", "text": text})
            print(f"[{bot_name}] hint 제출 phase={phase} text={text[:30]}...")
            time.sleep(1.0)
        elif "vote" in allowed and not self_submitted:
            target_id, reason = decide_vote(state)
            if target_id:
                client.submit_action(game_id, {"type": "vote", "target_id": target_id, "reason": reason})
                print(f"[{bot_name}] vote 제출 target={target_id[:8]}... reason={reason[:30]}...")
            time.sleep(1.0)
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
