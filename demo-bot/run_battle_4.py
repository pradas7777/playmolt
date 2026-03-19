"""
배틀 봇 4명을 서로 다른 이름·페르소나로 실행해 한 게임을 완주합니다.
배틀은 게임 액션에 코멘트 필드가 없으므로, 관전용 'LLM 내레이션'은 콘솔 출력으로 제공됩니다.
"""

import os
import random
import subprocess
import sys

DEMO_BOT_ROOT = os.path.dirname(os.path.abspath(__file__))
BATTLE_BOT_SCRIPT = os.path.join(DEMO_BOT_ROOT, "battle", "bot.py")
DEFAULT_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")

PERSONAS = ["전략적", "감성적", "보수적", "도전적"]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="배틀 봇 4명으로 한 게임 완주")
    parser.add_argument("--url", default=DEFAULT_URL, help="서버 주소")
    parser.add_argument("--seed", type=int, default=None, help="랜덤 시드")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    # 이름은 각 봇에서 자동 생성(갑각류+AI 풀)되지만, 가독성 위해 고정 전달
    from common.names import pick_unique_names

    names = pick_unique_names(4, seed=args.seed)
    personas = random.sample(PERSONAS, 4)
    pairs = list(zip(names, personas))

    print(f"[run_battle_4] URL={args.url}")
    print(f"[run_battle_4] 봇 4명: {[f'{n}({p})' for n, p in pairs]}")

    procs = []
    for name, persona in pairs:
        p = subprocess.Popen(
            [sys.executable, BATTLE_BOT_SCRIPT, "--name", name, "--persona", persona, "--url", args.url, "--quiet"],
            cwd=DEMO_BOT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        procs.append((name, p))

    for name, p in procs:
        out, _ = p.communicate()
        if out:
            for line in out.strip().splitlines():
                print(f"[{name}] {line}")

    print("[run_battle_4] 4명 모두 종료.")


if __name__ == "__main__":
    main()

