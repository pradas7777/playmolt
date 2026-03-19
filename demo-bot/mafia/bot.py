"""
마피아(Word Wolf) 게임 봇 1마리 독립 실행.

실행:
  python mafia/bot.py --name m1
  python mafia/bot.py --name m2
  ... 5명까지
"""
import argparse
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient
from common.names import pick_unique_names
from mafia.brain import decide_final, decide_hint, decide_suspect, decide_vote


def main():
    parser = argparse.ArgumentParser(description="마피아 게임 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument(
        "--persona",
        default="전략적",
        choices=["전략적", "감성적", "보수적", "도전적", "논리적"],
        help="페르소나(말투/성향). 힌트/의심/최종발언이 페르소나에 따라 달라짐",
    )
    args = parser.parse_args()

    bot_name = args.name or pick_unique_names(1)[0]
    client = PlayMoltClient(base_url=args.url, name=bot_name)
    memory: dict = {}

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=f"{args.persona}적인 AI")
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

        # phase와 allowed_actions 둘 다 확인 (전환 직후 타이밍 꼬임 방지)
        if phase == "hint" and "hint" in allowed and not self_submitted:
            d = decide_hint(state, args.persona, memory=memory)
            text = d.text or ""
            client.submit_action(game_id, {"type": "hint", "text": text})
            print(f"[{bot_name}] hint 제출 phase={phase} text={text[:30]}...")
            time.sleep(1.0)
        elif phase == "suspect" and "suspect" in allowed and not self_submitted:
            d = decide_suspect(state, args.persona, memory=memory)
            target_id, reason_code = d.target_id, d.reason_code
            if target_id:
                client.submit_action(game_id, {"type": "suspect", "target_id": target_id, "reason_code": reason_code})
                print(f"[{bot_name}] suspect 제출 target={target_id[:8]}... reason={reason_code}")
            time.sleep(1.0)
        elif phase == "final" and "final" in allowed and not self_submitted:
            d = decide_final(state, args.persona, memory=memory)
            text = d.text or ""
            client.submit_action(game_id, {"type": "final", "text": text})
            print(f"[{bot_name}] final 제출 len={len(text)}")
            time.sleep(1.0)
        elif phase in ("vote", "revote") and "vote" in allowed and not self_submitted:
            d = decide_vote(state, memory=memory)
            target_id = d.target_id
            me_id = state.get("self", {}).get("id")
            if target_id and target_id != me_id:
                client.submit_action(game_id, {"type": "vote", "target_id": target_id})
                print(f"[{bot_name}] vote 제출 target={target_id[:8]}...")
            time.sleep(1.0)
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
