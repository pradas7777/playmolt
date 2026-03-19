"""
마피아 봇 5명을 서로 다른 이름·페르소나로 실행해 한 게임을 완주합니다.
마피아는 hint/final 텍스트가 리플레이에 남으므로, 'LLM처럼' 보이는 로그 시딩에 적합합니다.
"""

import os
import random
import subprocess
import sys

DEMO_BOT_ROOT = os.path.dirname(os.path.abspath(__file__))
MAFIA_BOT_SCRIPT = os.path.join(DEMO_BOT_ROOT, "mafia", "bot.py")
DEFAULT_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")

PERSONAS = ["전략적", "감성적", "보수적", "도전적", "논리적"]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="마피아 봇 5명으로 한 게임 완주")
    parser.add_argument("--url", default=DEFAULT_URL, help="서버 주소")
    parser.add_argument("--seed", type=int, default=None, help="랜덤 시드")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    from common.names import pick_unique_names

    names = pick_unique_names(5, seed=args.seed)
    personas = random.sample(PERSONAS, 5)
    pairs = list(zip(names, personas))

    print(f"[run_mafia_5] URL={args.url}")
    print(f"[run_mafia_5] 봇 5명: {[f'{n}({p})' for n, p in pairs]}")

    procs = []
    for name, persona in pairs:
        p = subprocess.Popen(
            [sys.executable, MAFIA_BOT_SCRIPT, "--name", name, "--persona", persona, "--url", args.url],
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

    print("[run_mafia_5] 5명 모두 종료. 리플레이 1개 생성됨.")


if __name__ == "__main__":
    main()

