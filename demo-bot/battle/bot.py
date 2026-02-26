"""
배틀 게임 봇 1마리 독립 실행.

실행:
  python battle/bot.py --name testbot_1
  python battle/bot.py --name testbot_2
  python battle/bot.py   # 이름 생략 시 자동 생성
"""
import argparse
import sys
import time

# demo-bot 루트를 path에 넣어 common 임포트
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient
from battle.strategy import BattleStrategy


def main():
    parser = argparse.ArgumentParser(description="배틀 게임 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름 (생략 시 자동 생성)")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument("--persona", default="전략적인 AI 전사", help="에이전트 페르소나")
    parser.add_argument("--quiet", "-q", action="store_true", help="state/액션 로그 최소화 (라운드·액션만 간단히)")
    parser.add_argument("--poll", type=float, default=2.0, help="state 폴링 간격(초). 기본 2초 (서버 로그 감소)")
    args = parser.parse_args()

    bot_name = args.name or f"bot_{int(time.time())}"
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    # 1. 인증 + 챌린지
    info = client.register_and_verify(persona=args.persona)
    agent_id = info.get("agent_id", "")
    print(f"[{bot_name}] 인증 완료 agent_id={agent_id[:8] if agent_id else ''}...")

    # 2. 게임 참가 (대기열)
    game_id = client.join_game("battle")
    # 관전용 프론트에서 쓰기 쉽도록 전체 game_id도 함께 출력
    short_gid = game_id[:8] + "..." if game_id else ""
    print(f"[{bot_name}] 게임 참가 game_id={short_gid}")
    if game_id:
        print(f"[{bot_name}] >>> FULL_GAME_ID={game_id}")

    strategy = BattleStrategy()
    last_acted_round = -1

    while True:
        state = client.get_state(game_id)

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            win = result.get("isWinner", False)
            pts = result.get("points", 0)
            print(f"[{bot_name}] 게임 종료 | 승리={win} 포인트={pts}")
            break

        if not state.get("self", {}).get("isAlive", True):
            print(f"[{bot_name}] 사망 (Round {state.get('round', 0)})")
            print(f"[{bot_name}] 게임 종료 대기...")
            break

        phase = state.get("phase", "")
        current_round = int(state.get("round", 0))

        if phase == "collect" and current_round != last_acted_round:
            me = state.get("self", {})
            if not args.quiet:
                print(f"[{bot_name}] Round {current_round} | hp={me.get('hp')} energy={me.get('energy')}")

            try:
                action = strategy.decide_action(state)
            except Exception:
                action = {"type": "charge"}
            if not action or not isinstance(action, dict):
                action = {"type": "charge"}
            if action.get("type") == "attack" and not action.get("target_id"):
                action = {"type": "charge"}

            try:
                client.submit_action(game_id, action)
            except Exception as e:
                if "400" in str(e) or "INVALID" in str(e).upper():
                    client.submit_action(game_id, {"type": "charge"})
                else:
                    raise

            if not args.quiet:
                action_desc = action.get("type", "?")
                if action_desc == "attack":
                    action_desc = f"attack target={action.get('target_id', '')[:8]}..."
                print(f"[{bot_name}] action={action_desc} 제출")
            else:
                print(f"[{bot_name}] R{current_round} 액션 제출")
            last_acted_round = current_round
            time.sleep(1.0)
        else:
            time.sleep(args.poll)


if __name__ == "__main__":
    main()
