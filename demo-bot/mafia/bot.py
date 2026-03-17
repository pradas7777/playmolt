"""
마피아(Word Wolf) 게임 봇 1마리 독립 실행.

실행:
  python mafia/bot.py --name m1
  python mafia/bot.py --name m2
  ... 5명까지
"""
import argparse
import random
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient

REASON_CODES = ("AMBIGUOUS", "TOO_SPECIFIC", "OFF_TONE", "ETC")
FINAL_MIN = 40
FINAL_MAX = 140


def decide_hint(state: dict) -> str:
    """자신의 단어(secretWord)를 직접 말하지 않고 힌트 1문장."""
    hints = [
        "이 단어와 관련된 것을 생각해보세요.",
        "일상에서 자주 접하는 것입니다.",
        "한 단어로 설명할 수 있습니다.",
    ]
    return random.choice(hints)[:100]


def decide_suspect(state: dict) -> tuple[str, str]:
    """참가자 중 자기 제외 랜덤 1명 지목 + reason_code."""
    participants = state.get("participants", [])
    me_id = state.get("self", {}).get("id")
    others = [p for p in participants if p.get("id") != me_id]
    if not others:
        return "", "ETC"
    target = random.choice(others)
    reason = random.choice(REASON_CODES)
    return target["id"], reason


def decide_final(state: dict) -> str:
    """최후 변론 40~140자."""
    base = "저는 시민입니다. 제 힌트를 다시 생각해보시면 알 수 있을 겁니다. "
    text = (base * 5)[:FINAL_MAX]
    if len(text) < FINAL_MIN:
        text = text.ljust(FINAL_MIN, ".")
    return text


def decide_vote(state: dict) -> str:
    """참가자 중 자기 제외 랜덤 1명 지목. revote면 revote_candidates 중에서(자기 제외)."""
    participants = state.get("participants", [])
    me_id = state.get("self", {}).get("id")
    revote_candidates = state.get("revote_candidates", [])
    if revote_candidates:
        others_revote = [c for c in revote_candidates if c != me_id]
        if others_revote:
            return random.choice(others_revote)
        # 동점 후보가 자기뿐이면(비정상) 일반 참가자에서 선택
    others = [p["id"] for p in participants if p.get("id") != me_id]
    if not others:
        return ""
    return random.choice(others)


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

        # phase와 allowed_actions 둘 다 확인 (전환 직후 타이밍 꼬임 방지)
        if phase == "hint" and "hint" in allowed and not self_submitted:
            text = decide_hint(state)
            client.submit_action(game_id, {"type": "hint", "text": text})
            print(f"[{bot_name}] hint 제출 phase={phase} text={text[:30]}...")
            time.sleep(1.0)
        elif phase == "suspect" and "suspect" in allowed and not self_submitted:
            target_id, reason_code = decide_suspect(state)
            if target_id:
                client.submit_action(game_id, {"type": "suspect", "target_id": target_id, "reason_code": reason_code})
                print(f"[{bot_name}] suspect 제출 target={target_id[:8]}... reason={reason_code}")
            time.sleep(1.0)
        elif phase == "final" and "final" in allowed and not self_submitted:
            text = decide_final(state)
            client.submit_action(game_id, {"type": "final", "text": text})
            print(f"[{bot_name}] final 제출 len={len(text)}")
            time.sleep(1.0)
        elif phase in ("vote", "revote") and "vote" in allowed and not self_submitted:
            target_id = decide_vote(state)
            me_id = state.get("self", {}).get("id")
            if target_id and target_id != me_id:
                client.submit_action(game_id, {"type": "vote", "target_id": target_id})
                print(f"[{bot_name}] vote 제출 target={target_id[:8]}...")
            time.sleep(1.0)
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
