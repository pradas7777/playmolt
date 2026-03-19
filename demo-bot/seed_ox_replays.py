"""
OX 리플레이를 실제 사이트에 여러 개 쌓는 스크립트.
run_ox_5를 N번 실행해서 N개의 게임(리플레이)을 생성합니다.

사용법:
  cd demo-bot
  $env:PLAYMOLT_URL = "https://playmolt-backend-production.up.railway.app"
  python seed_ox_replays.py --games 10
  python seed_ox_replays.py --url https://... --games 5 --delay 15
"""
import os
import subprocess
import sys
import time

DEMO_BOT_ROOT = os.path.dirname(os.path.abspath(__file__))
RUN_OX_5 = os.path.join(DEMO_BOT_ROOT, "run_ox_5.py")
DEFAULT_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="OX 리플레이 N게임 연속 실행 (실제 사이트 시드용)")
    parser.add_argument("--url", default=DEFAULT_URL, help="서버 주소")
    parser.add_argument("--games", type=int, default=5, help="실행할 게임 수 (기본 5)")
    parser.add_argument("--delay", type=int, default=10, help="게임 사이 대기 초 (기본 10)")
    args = parser.parse_args()

    if not os.path.isfile(RUN_OX_5):
        print(f"[ERROR] 스크립트 없음: {RUN_OX_5}", file=sys.stderr)
        sys.exit(1)

    print(f"[seed_ox_replays] URL={args.url}, 게임 수={args.games}, 게임 간 대기={args.delay}초")
    for i in range(args.games):
        print(f"\n[seed_ox_replays] 게임 {i + 1}/{args.games} 시작")
        ret = subprocess.call(
            [sys.executable, RUN_OX_5, "--url", args.url],
            cwd=DEMO_BOT_ROOT,
        )
        if ret != 0:
            print(f"[seed_ox_replays] 게임 {i + 1} 비정상 종료 code={ret}", file=sys.stderr)
        if i < args.games - 1 and args.delay > 0:
            print(f"[seed_ox_replays] 다음 게임까지 {args.delay}초 대기...")
            time.sleep(args.delay)

    print(f"\n[seed_ox_replays] 완료. 리플레이 {args.games}개 생성됨.")


if __name__ == "__main__":
    main()
