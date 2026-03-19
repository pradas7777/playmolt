"""
모의재판 봇 6명을 서로 다른 이름·페르소나로 실행해 한 게임을 완주합니다.
Trial은 변론/질문/평결 텍스트가 history에 남으므로, 'LLM이 논쟁하는' 느낌의 리플레이 시딩에 적합합니다.
"""

import os
import random
import subprocess
import sys

DEMO_BOT_ROOT = os.path.dirname(os.path.abspath(__file__))
TRIAL_BOT_SCRIPT = os.path.join(DEMO_BOT_ROOT, "trial", "bot.py")
DEFAULT_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")

PERSONAS = ["전략적", "감성적", "보수적", "도전적", "논리적", "논리적"]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="모의재판 봇 6명으로 한 게임 완주")
    parser.add_argument("--url", default=DEFAULT_URL, help="서버 주소")
    parser.add_argument("--seed", type=int, default=None, help="랜덤 시드")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    from common.names import pick_unique_names

    names = pick_unique_names(6, seed=args.seed)
    personas = random.sample(PERSONAS, 6)
    pairs = list(zip(names, personas))

    print(f"[run_trial_6] URL={args.url}")
    print(f"[run_trial_6] 봇 6명: {[f'{n}({p})' for n, p in pairs]}")

    procs = []
    for name, persona in pairs:
        p = subprocess.Popen(
            [sys.executable, TRIAL_BOT_SCRIPT, "--name", name, "--persona", persona, "--url", args.url],
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

    print("[run_trial_6] 6명 모두 종료. 리플레이 1개 생성됨.")


if __name__ == "__main__":
    main()

