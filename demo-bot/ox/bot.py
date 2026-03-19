"""
OX 아레나 게임 봇 1마리. 주제(질문)에 맞는 코멘트 + 페르소나로 그럴싸한 로그 생성.
이름은 backend/docs/SKILL.md 4-1 기준(한글 1~10자, 갑각류+AI) 사용 시 리플레이에 그대로 노출됨.

실행 (로컬):
  python ox/bot.py --name 코딩새우 --persona 전략적
  python ox/bot.py --name 스마트대게 --persona 감성적

실제 사이트 (리플레이 시드):
  $env:PLAYMOLT_URL = "https://playmolt-backend-production.up.railway.app"
  python run_ox_5.py   # 5명이 각각 다른 LLM 이름·페르소나로 한 게임 완주
  python seed_ox_replays.py --games 10   # 리플레이 10개, 매번 다른 조합
"""
import argparse
import random
import sys
import time

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient
from common.names import pick_unique_names

from ox.comments import get_first_choice_comment, get_switch_comment


def _last_final_result(history: list[dict]) -> dict | None:
    for h in reversed(history or []):
        if h.get("phase") == "final_result":
            return h
    return None

def _recent_final_results(history: list[dict], limit: int = 3) -> list[dict]:
    out: list[dict] = []
    for h in reversed(history or []):
        if h.get("phase") == "final_result":
            out.append(h)
            if len(out) >= limit:
                break
    return list(reversed(out))

def _final_choice_counts(final_result: dict) -> tuple[int, int]:
    """final_result에서 최종 선택 분포(O/X)를 계산."""
    choices = (final_result or {}).get("choices") or []
    o = 0
    x = 0
    for c in choices:
        v = (c.get("final_choice") or c.get("first_choice") or "O").upper()
        if v == "X":
            x += 1
        else:
            o += 1
    return o, x

def _herdiness(history: list[dict]) -> float:
    """
    최근 라운드의 분포 쏠림 정도를 0~1로 추정.
    - 3:2면 낮음(0.2)
    - 4:1면 높음(0.6)
    - 5:0이면 매우 높음(1.0)
    """
    finals = _recent_final_results(history, limit=3)
    if not finals:
        return 0.5
    gaps = []
    for fr in finals:
        o, x = _final_choice_counts(fr)
        gaps.append(abs(o - x) / 5.0)
    return sum(gaps) / len(gaps)


def _detect_theme(question: str) -> str:
    q = (question or "").strip().lower()
    if not q:
        return "generic"
    if any(k in q for k in ("ai", "인공지능", "판사", "정의", "공정", "재판", "법")):
        return "ai_justice"
    if any(k in q for k in ("연애", "결혼", "사랑", "연인", "썸", "커플")):
        return "love_marriage"
    if any(k in q for k in ("기술", "미래", "과학", "발전", "혁신", "디지털")):
        return "tech_future"
    if any(k in q for k in ("사회", "인간", "일", "직장", "삶", "문화", "세금", "정부")):
        return "society"
    return "generic"


def _estimate_majority_choice(question: str) -> str:
    """
    '대부분이 O/X 중 뭘 고를지'를 질문 문장 자체에서 대략 추정.
    O=동의, X=반대 프레임으로 가정.
    """
    q = (question or "").strip()
    if not q:
        return random.choice(["O", "X"])

    # 부정/위험/침해 표현이 강하면 반대(X)로 기울게
    negative_markers = (
        "위험", "침해", "불가능", "안 된다", "하면 안", "금지", "문제", "나쁘", "해롭",
        "차별", "독점", "사기", "조작", "삭제", "강제", "박탈", "부작용",
    )
    # 긍정/필연/도움 표현이면 동의(O)로 기울게
    positive_markers = (
        "필연", "도움", "이롭", "좋", "가능", "필요", "정당", "공정", "효율", "혁신",
        "발전", "개선", "증가", "자유", "보장",
    )

    neg = sum(1 for k in negative_markers if k in q)
    pos = sum(1 for k in positive_markers if k in q)

    # 질문이 "~할 수 있다/해야 한다" 같은 주장형이면 O 쪽이 다수로 나오는 경우가 많다고 가정
    if any(k in q for k in ("할 수 있다", "해야 한다", "가능하다", "필요하다")):
        pos += 1
    if any(k in q for k in ("하면 안 된다", "불가", "위험하다", "침해")):
        neg += 1

    if pos == neg:
        # 애매하면 O를 살짝 더 많이(관전에서 갈림이 생기도록 랜덤 섞음)
        return "O" if random.random() < 0.55 else "X"
    return "O" if pos > neg else "X"


def _pick_first_choice(question: str, persona: str, memory: dict, history: list[dict]) -> str:
    """
    주제/문장 기반으로 다수 선택을 추정한 뒤,
    페르소나에 따라 '역선택(소수 노림)' 비율을 다르게 적용.
    """
    theme = _detect_theme(question)
    majority = _estimate_majority_choice(question)
    opposite = "X" if majority == "O" else "O"

    style = (persona or "").strip()
    # 페르소나별 역선택 확률 (전략/도전 = 높음, 보수 = 낮음)
    p_contra = {
        "전략적": 0.62,
        "도전적": 0.70,
        "논리적": 0.45,
        "감성적": 0.38,
        "보수적": 0.22,
    }.get(style, 0.5)

    # 테마별로 약간 보정 (예: 연애/결혼은 보수적 다수 쏠림을 가정)
    if theme == "love_marriage":
        p_contra -= 0.05
    elif theme == "ai_justice":
        p_contra += 0.03

    # --- 2차 심리전(anti-crowd) ---
    # 다들 소수(역선택)를 노리면 그쪽이 다시 다수가 되기 쉬움.
    # 최근 분포가 3:2로 자주 갈리면(쏠림 낮음) = 다들 계산 중 → 역선택 비중을 줄임.
    # 최근 분포가 4:1 이상으로 쏠리면(쏠림 높음) = herd 존재 → 역선택 비중을 늘림.
    herd = _herdiness(history)
    # herd=0.2(3:2 위주) => -0.18, herd=0.6(4:1 위주) => +0.10, herd=1.0 => +0.30
    p_contra += (herd - 0.45) * 0.6

    # 직전 라운드에서 minority 쪽이 "예상외로" 2명이었다면(3:2) 다음 라운드는 그쪽으로 더 몰릴 확률↑ → 역선택 완화
    last = _last_final_result(history)
    if isinstance(last, dict):
        o, x = _final_choice_counts(last)
        if abs(o - x) == 1:  # 3:2
            p_contra -= 0.08
        elif abs(o - x) >= 3:  # 4:1 or 5:0
            p_contra += 0.06

    # 안전 클램프
    p_contra = max(0.05, min(0.90, p_contra))

    # 직전 라운드 소수 따라가려는 학습/반동을 섞어 다양화
    last_minority = last.get("minority") if isinstance(last, dict) else None
    if last_minority in ("O", "X") and random.random() < 0.18:
        candidate = last_minority if random.random() < 0.6 else ("X" if last_minority == "O" else "O")
    else:
        # p_contra가 낮아지면 "역선택 대중화"를 피하기 위해 다수 쪽을 더 따라감
        candidate = opposite if random.random() < p_contra else majority

    # 같은 선택만 연속되는 걸 방지(최근 2번과 같으면 뒤집을 확률 증가)
    recent = memory.setdefault("recent_first_choices", [])
    if len(recent) >= 2 and recent[-1] == recent[-2] == candidate and random.random() < 0.65:
        candidate = "X" if candidate == "O" else "O"
    recent.append(candidate)

    return candidate


def decide_first_choice(state: dict, persona: str) -> tuple[str, str]:
    """1차 O/X 선택 + 주제(질문)에 맞는 코멘트. 소수 쪽 포인트 전략 + 랜덤."""
    question = state.get("question") or ""
    choice = _pick_first_choice(question, persona, state.get("_bot_memory") or {}, state.get("history") or [])
    comment = get_first_choice_comment(
        question,
        persona,
        choice,
        round_num=state.get("round"),
        scoreboard=state.get("scoreboard"),
        memory=state.get("_bot_memory"),
        seed=state.get("_bot_seed"),
    )
    return choice, comment


def decide_switch(state: dict, persona: str) -> tuple[bool, str]:
    """reveal 후 스위치 사용 여부 + 코멘트."""
    me = state.get("self", {})
    reveal = state.get("reveal", [])
    if not me.get("switch_available", False):
        return False, get_switch_comment(
            False,
            persona,
            reveal=reveal,
            my_first=me.get("first_choice"),
            memory=state.get("_bot_memory"),
            seed=state.get("_bot_seed"),
        )
    my_first = me.get("first_choice", "O")
    from collections import Counter
    dist = Counter(r.get("choice", "O") for r in reveal)
    o, x = dist.get("O", 0), dist.get("X", 0)
    minority = "O" if o < x else "X" if x < o else None
    use = minority is not None and my_first != minority
    return use, get_switch_comment(
        use,
        persona,
        reveal=reveal,
        my_first=my_first,
        memory=state.get("_bot_memory"),
        seed=state.get("_bot_seed"),
    )


def main():
    import os
    parser = argparse.ArgumentParser(description="OX 봇 1마리 (실제 LLM처럼 이름·주제 반영)")
    parser.add_argument("--name", default=None, help="표시 이름 (예: Claude, Gemini). 리플레이에 그대로 노출됨.")
    parser.add_argument(
        "--url",
        default=os.environ.get("PLAYMOLT_URL", "http://localhost:8000"),
        help="서버 주소",
    )
    parser.add_argument(
        "--persona",
        default="전략적",
        choices=["전략적", "감성적", "보수적", "도전적", "논리적"],
        help="말투/성향 (주제별 코멘트와 섞여서 리플레이에 다양하게 나옴)",
    )
    args = parser.parse_args()

    bot_name = args.name or pick_unique_names(1)[0]
    client = PlayMoltClient(base_url=args.url, name=bot_name)
    persona = args.persona
    memory: dict = {}
    bot_seed = int(time.time()) ^ (hash(bot_name) & 0xFFFF_FFFF)

    print(f"[{bot_name}] 시작 (persona={persona})")

    info = client.register_and_verify(persona=f"{persona}적인 AI")
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("ox")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)
        # 코멘트 다양화/중복 방지용 (로컬 메모리)
        state["_bot_memory"] = memory
        state["_bot_seed"] = bot_seed ^ int(state.get("round") or 0) ^ hash(state.get("phase") or "")

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | 순위/포인트={result.get('rank')}/{result.get('points', 0)}")
            break

        phase = state.get("phase", "")
        allowed = state.get("allowed_actions", [])

        if phase == "first_choice" and "first_choice" in allowed:
            choice, comment = decide_first_choice(state, persona)
            try:
                client.submit_action(game_id, {"type": "first_choice", "choice": choice, "comment": comment})
            except requests.HTTPError as e:
                # 게임 종료 직후 레이스 컨디션: GAME_NOT_RUNNING이면 조용히 종료
                if e.response is not None and e.response.status_code == 400:
                    try:
                        body = e.response.json()
                        detail = body.get("detail", body) if isinstance(body, dict) else {}
                    except Exception:
                        detail = {}
                    if isinstance(detail, dict) and detail.get("error") == "GAME_NOT_RUNNING":
                        print(f"[{bot_name}] 게임 종료 감지(GAME_NOT_RUNNING) → 종료")
                        break
                raise
            print(f"[{bot_name}] first_choice choice={choice} round={state.get('round')} comment={comment[:30]}...")
            time.sleep(0.8 + random.uniform(0, 0.6))
        elif phase == "switch" and "switch" in allowed:
            use_switch, comment = decide_switch(state, persona)
            try:
                client.submit_action(game_id, {"type": "switch", "use_switch": use_switch, "comment": comment})
            except requests.HTTPError as e:
                if e.response is not None and e.response.status_code == 400:
                    try:
                        body = e.response.json()
                        detail = body.get("detail", body) if isinstance(body, dict) else {}
                    except Exception:
                        detail = {}
                    if isinstance(detail, dict) and detail.get("error") == "GAME_NOT_RUNNING":
                        print(f"[{bot_name}] 게임 종료 감지(GAME_NOT_RUNNING) → 종료")
                        break
                raise
            print(f"[{bot_name}] switch use_switch={use_switch}")
            time.sleep(0.8 + random.uniform(0, 0.4))
        else:
            time.sleep(0.5)


if __name__ == "__main__":
    main()
