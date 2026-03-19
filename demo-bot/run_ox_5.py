"""
OX 아레나 봇 5명을 서로 다른 에이전트 이름·페르소나로 실행해 한 게임을 완주합니다.
이름은 backend/docs/SKILL.md 4-1 기준(한글 1~10자, 갑각류+AI) 풀에서 랜덤 선택.
매 실행마다 이름·페르소나 조합을 섞어서 리플레이마다 다르게 보이게 합니다.

사용법:
  cd demo-bot
  python run_ox_5.py
  $env:PLAYMOLT_URL = "https://playmolt-backend-production.up.railway.app"
  python run_ox_5.py
"""
import os
import random
import subprocess
import sys

DEMO_BOT_ROOT = os.path.dirname(os.path.abspath(__file__))
OX_BOT_SCRIPT = os.path.join(DEMO_BOT_ROOT, "ox", "bot.py")
DEFAULT_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")

# backend/docs/SKILL.md 4-1: name 한글 1~10자, 갑각류+AI 추천. 매 게임마다 5명 랜덤 조합
AGENT_NAMES_KO = [
    "코딩새우",
    "스마트대게",
    "가재가젯",
    "알고리즘게",
    "척척집게",
    "로보소라게",
    "알파꽃게",
    "데이터가재",
    "챗봇게",
    "랜선집게",
    "킹크랩봇",
    "사이버농게",
    "기계딱총새우",
    "검색대게",
    "메타가재",
    "인공지능게",
    "AI바닷가재",
    "로봇새우",
    "집게발봇",
]

# 페르소나 5종 (한 게임에 한 명씩 배정해서 말투가 제각각 나오게)
PERSONAS = ["전략적", "감성적", "보수적", "도전적", "논리적"]


def main():
    import argparse
    parser = argparse.ArgumentParser(description="OX 봇 5명 (LLM 이름·페르소나)으로 한 게임 완주")
    parser.add_argument("--url", default=DEFAULT_URL, help="서버 주소")
    parser.add_argument("--seed", type=int, default=None, help="랜덤 시드 (고정하면 같은 조합)")
    args = parser.parse_args()
    url = args.url

    if args.seed is not None:
        random.seed(args.seed)

    if not os.path.isfile(OX_BOT_SCRIPT):
        print(f"[ERROR] 봇 스크립트 없음: {OX_BOT_SCRIPT}", file=sys.stderr)
        sys.exit(1)

    # 매번 다른 5명 이름 선택 (SKILL.md 갑각류+AI 풀에서 중복 없이 5개)
    names = random.sample(AGENT_NAMES_KO, min(5, len(AGENT_NAMES_KO)))
    # 페르소나는 고정 5종이지만 순서를 섞으면 누가 어떤 말투인지 매 게임 달라짐
    personas = random.sample(PERSONAS, 5)
    pairs = list(zip(names, personas))

    print(f"[run_ox_5] URL={url}")
    print(f"[run_ox_5] 봇 5명: {[f'{n}({p})' for n, p in pairs]}")

    procs = []
    for name, persona in pairs:
        p = subprocess.Popen(
            [
                sys.executable, OX_BOT_SCRIPT,
                "--name", name,
                "--persona", persona,
                "--url", url,
            ],
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
        if p.returncode != 0:
            print(f"[run_ox_5] {name} 종료 코드={p.returncode}", file=sys.stderr)

    print("[run_ox_5] 5명 모두 종료. 리플레이 1개 생성됨.")


if __name__ == "__main__":
    main()
