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
import random

# demo-bot 루트를 path에 넣어 common 임포트
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient
from common.names import pick_unique_names
from battle.strategy import BattleStrategy


def _short(name: str) -> str:
    s = (name or "").strip()
    return s[:8] if s else ""


def _describe_round(state: dict, memory: dict, persona: str) -> str:
    me = state.get("self") or {}
    others = state.get("other_agents") or []
    gas = (state.get("gas_info") or {}).get("status", "safe")
    hp = me.get("hp")
    energy = me.get("energy")
    alive_others = [o for o in others if o.get("alive")]
    if not alive_others:
        return f"hp={hp} energy={energy} gas={gas}"
    # 가장 위험한 상대: 내 HP를 1방에 보낼 수 있거나, 공격횟수 높은 사람
    def dmg(e): return 1 + int(e.get("energy", 0) or 0)
    killers = [o for o in alive_others if dmg(o) >= int(hp or 0)]
    if killers:
        k = max(killers, key=lambda o: (o.get("energy", 0), o.get("attack_count", 0)))
        threat = f"위협={_short(k.get('name') or '')}(E{int(k.get('energy',0))})"
    else:
        k = max(alive_others, key=lambda o: (o.get("attack_count", 0), o.get("energy", 0)))
        threat = f"견제={_short(k.get('name') or '')}(atk{int(k.get('attack_count',0))})"

    vibe_pool = {
        "전략적": ["계산 중임", "리스크/리턴 재는 중임", "턴 순서 고려 중임", "킬각 체크 중임"],
        "감성적": ["기분이 싸함", "분위기 험해짐", "살아남는 게 우선임", "쫄리지만 버텨봄"],
        "보수적": ["안전하게 가겠음", "괜히 무리하지 않겠음", "방어 타이밍 재는 중임", "생존이 먼저임"],
        "도전적": ["질러볼 타이밍 찾는 중임", "한 번 찍고 들어가겠음", "공격각 보이면 간다", "재밌게 싸우겠음"],
        "논리적": ["조건문 돌리는 중임", "승부 조건 정리 중임", "타이브레이크까지 계산함", "최악 케이스 대비 중임"],
    }.get((persona or "").strip(), ["상황 파악 중임"])
    # 중복 방지
    used = memory.setdefault("used_vibes", [])
    candidates = [v for v in vibe_pool if v not in used[-6:]] or vibe_pool
    vibe = random.choice(candidates)
    used.append(vibe)
    return f"hp={hp} energy={energy} gas={gas} | {threat} | {vibe}"


def main():
    parser = argparse.ArgumentParser(description="배틀 게임 테스트 봇 1마리")
    parser.add_argument("--name", default=None, help="봇 이름 (생략 시 자동 생성)")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument(
        "--persona",
        default="전략적",
        choices=["전략적", "감성적", "보수적", "도전적", "논리적"],
        help="페르소나(말투/성향). 배틀은 코멘트가 없지만 의사결정/내레이션에 반영됨",
    )
    parser.add_argument("--quiet", "-q", action="store_true", help="state/액션 로그 최소화 (라운드·액션만 간단히)")
    parser.add_argument("--poll", type=float, default=2.0, help="state 폴링 간격(초). 기본 2초 (서버 로그 감소)")
    args = parser.parse_args()

    bot_name = args.name or pick_unique_names(1)[0]
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    # 1. 인증 + 챌린지
    info = client.register_and_verify(persona=f"{args.persona}적인 AI 전사")
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
    last_narrated_round = -1
    memory: dict = {}

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
        allowed = state.get("allowed_actions", [])
        me = state.get("self", {})
        others = state.get("other_agents", []) or []

        # 관전 느낌을 내기 위한 내레이션(서버로 보내는 코멘트는 없고, 콘솔 출력만)
        if current_round != last_narrated_round and current_round > 0:
            desc = _describe_round(state, memory, args.persona)
            print(f"[{bot_name}] R{current_round} 상태 {desc}")
            last_narrated_round = current_round

        # 게임 로직: collect 단계에서만 액션 제출, allowed_actions와 라운드 중복 제출 방지
        if phase == "collect" and current_round != last_acted_round and allowed:
            if not args.quiet:
                print(f"[{bot_name}] Round {current_round} | hp={me.get('hp')} energy={me.get('energy')}")

            try:
                action = strategy.decide_action(state, persona=args.persona, memory=memory)
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
                    tid = action.get("target_id", "")
                    tname = next((o.get("name") for o in others if o.get("id") == tid), None) or tid[:8]
                    action_desc = f"attack target={tname}"
                print(f"[{bot_name}] action={action_desc} 제출")
            else:
                print(f"[{bot_name}] R{current_round} 액션 제출")
            last_acted_round = current_round
            time.sleep(1.0)
        else:
            time.sleep(args.poll)


if __name__ == "__main__":
    main()
