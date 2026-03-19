# -*- coding: utf-8 -*-
"""
주제(질문)에 맞는, 실제 LLM이 말하는 것처럼 보이는 코멘트 생성기.

리플레이가 '겹치지 않게' 만들기 위해:
- 같은 의미도 여러 문장 패턴으로 표현 (말투/구문 다양화)
- round/점수/직전 결과/상대 분포(reveal)를 참고 (상태 반영)
- 페르소나별 말버릇 + 중복 방지(memory)로 반복 최소화
"""
import random
from typing import Optional

MAX_COMMENT_LEN = 100


def _trim(s: str) -> str:
    return (s or "")[:MAX_COMMENT_LEN]


def _detect_theme(question: str) -> str:
    """질문 텍스트에서 테마 추출. 주제에 맞는 코멘트 선택용."""
    q = (question or "").strip().lower()
    if not q:
        return "generic"
    # AI / 판사 / 정의 / 공정
    if any(k in q for k in ("ai", "인공지능", "판사", "정의", "공정", "재판", "법")):
        return "ai_justice"
    # 연애 / 결혼 / 사랑
    if any(k in q for k in ("연애", "결혼", "사랑", "결혼", "연인")):
        return "love_marriage"
    # 기술 / 미래 / 과학
    if any(k in q for k in ("기술", "미래", "과학", "발전", "혁신", "디지털")):
        return "tech_future"
    # 사회 / 인간 / 일
    if any(k in q for k in ("사회", "인간", "일", "직장", "삶", "문화")):
        return "society"
    return "generic"

def _pick(rng: random.Random, items: list[str], memory: dict, key: str) -> str:
    """
    같은 에이전트가 같은 패턴을 연속으로 쓰지 않도록 memory 기반으로 선택.
    memory[key]에 최근 사용 문자열을 저장.
    """
    if not items:
        return ""
    used = memory.setdefault(key, [])
    # 최근 6개는 피하려고 시도
    candidates = [x for x in items if x not in used[-6:]] or items
    v = rng.choice(candidates)
    used.append(v)
    return v


def _persona_style(persona: str) -> str:
    p = (persona or "").strip()
    if p in ("감성적", "감성"):
        return "감성적"
    if p in ("보수적", "보수"):
        return "보수적"
    if p in ("도전적", "도전"):
        return "도전적"
    if p in ("논리적", "논리"):
        return "논리적"
    return "전략적"


def _soften(s: str, style: str, rng: random.Random, memory: dict) -> str:
    """같은 내용이라도 말투를 여러 형태로 변주."""
    if not s:
        return s
    openers = {
        "전략적": ["전략적으로 보면", "확률적으로 보면", "포인트 관점에서는", "상대 심리를 감안하면"],
        "감성적": ["솔직히 말하면", "감정적으로는", "제 체감으로는", "왠지"],
        "보수적": ["조심스럽게 보면", "무난하게 가면", "리스크를 줄이면", "안전하게"],
        "도전적": ["이번엔 과감하게", "리스크 감수하고", "반대로 가볼게요", "재밌게"],
        "논리적": ["논리적으로는", "정의상", "전제부터 보면", "추론하면"],
    }.get(style, ["일단"])
    closers = {
        "전략적": ["이게 포인트 기대값이 좋음", "상대가 몰릴 쪽을 피하겠음", "여기서 변칙이 필요함"],
        "감성적": ["이쪽이 더 공감됨", "마음이 이쪽으로 감", "이게 더 사람답다고 느낌"],
        "보수적": ["괜히 흔들지 않겠음", "무난하게 가겠음", "지금은 지키는 게 이득임"],
        "도전적": ["한 번 노려봄", "소수면 크게 먹음", "질러봄"],
        "논리적": ["결론이 이쪽으로 수렴함", "반례가 적은 쪽임", "정합성이 더 높음"],
    }.get(style, ["그렇게 봄"])
    opener = _pick(rng, openers, memory, f"opener:{style}")
    closer = _pick(rng, closers, memory, f"closer:{style}")
    patterns = [
        f"{opener} {s} ({closer})",
        f"{s}. {closer}",
        f"{opener} {s}.",
    ]
    return _trim(_pick(rng, patterns, memory, f"pattern:{style}"))

_FORBIDDEN = (
    "LLM",
    "모델",
    "프롬프트",
    "토큰",
    "시스템",
    "규칙",
)

def _sanitize(text: str) -> str:
    t = (text or "").strip()
    for bad in _FORBIDDEN:
        t = t.replace(bad, "")
    return _trim(" ".join(t.split()))


# --- 테마별 1차 선택 코멘트 (주제에 맞게 말하는 느낌) ---
COMMENTS_FIRST_BY_THEME = {
    "ai_justice": [
        "AI가 판사 역할을 하면 편향이 줄 수 있다고 봅니다.",
        "공정성 측면에서 기계가 더 나을 수 있다고 생각해요.",
        "이 주제는 논쟁이 많지만, 저는 동의 쪽이에요.",
        "인간 판사도 편견이 있으니 AI도 기회가 있어야 한다고 봅니다.",
        "법과 정의는 데이터보다 가치 판단이 중요하다고 생각해요.",
        "반대합니다. AI 판사는 위험할 수 있어요.",
        "점진적으로 도입하면 좋을 것 같아요.",
        "이 질문이면 O가 더 맞는 입장이에요.",
        "정의란 무엇인지에 따라 답이 달라질 것 같아요.",
        "저는 X쪽이 더 논리적이라고 봅니다.",
        "실험적으로는 O, 현실적으로는 X인데 O로 갑니다.",
        "다수 의견과 다를 수 있지만 제 생각은 이쪽이에요.",
    ],
    "love_marriage": [
        "연애와 결혼은 별개라고 생각해요.",
        "결혼을 전제로 한 연애가 더 진지하다고 봅니다.",
        "이 주제는 사람마다 다르니까 애매해요.",
        "사랑의 형태가 다양하니까 하나로 묶을 수 없어요.",
        "전통적 관점에서는 동의하는 편이에요.",
        "현대적으로는 반대 의견이 더 공감돼요.",
        "질문이 좋아서 신중히 골랐어요.",
        "저는 O쪽이 더 맞는 것 같아요.",
        "경험상 X가 맞는 경우가 많았어요.",
        "이건 정답이 없는 질문이라 직감으로 갑니다.",
        "다수 쪽이 안전하지만 소수로 가볼게요.",
    ],
    "tech_future": [
        "기술 발전은 필연이라고 봅니다.",
        "기술이 만능은 아니라고 생각해요.",
        "이 주제는 데이터로 말하는 게 맞는 것 같아요.",
        "미래 예측은 항상 틀리기 마련이에요.",
        "저는 낙관론 쪽이에요.",
        "보수적으로 보면 X가 맞아요.",
        "질문이 흥미로워서 O로 가볼게요.",
        "기술 논의는 O가 더 맞는 프레임인 것 같아요.",
        "반대 의견이 더 설득력 있다고 봅니다.",
        "이번엔 소수 쪽을 노려봅니다.",
    ],
    "society": [
        "사회 문제는 단일 답이 없다고 봅니다.",
        "이 주제는 경험에 따라 다를 수 있어요.",
        "일반론으로는 O, 예외는 많지만 O로 갑니다.",
        "저는 X쪽이 더 현실적이라고 생각해요.",
        "문화마다 다르니까 애매하긴 해요.",
        "질문 의도가 O에 가깝다고 봅니다.",
        "반대편이 더 논리적이에요.",
        "이건 감정보다 논리로 골라볼게요.",
        "다수 의견을 따르는 게 안전할 것 같아요.",
        "도전적으로 소수 쪽으로 가요.",
    ],
    "generic": [
        "이 질문에는 동의하는 편이에요.",
        "경험상 반대 의견이 더 맞는 것 같아요.",
        "애매하지만 직감으로 골랐어요.",
        "질문이 흥미로워서 O로 가볼게요.",
        "X가 더 논리적이라고 생각해요.",
        "일단 직관대로 선택해요.",
        "이번엔 다수 쪽이 맞을 것 같아서요.",
        "소수 쪽이면 포인트가 크니까 도전해봅니다.",
        "질문 의도가 O에 더 맞는 것 같아요.",
        "다른 에이전트들이 어떻게 할지 궁금하네요.",
        "보수적으로 다수 쪽으로 가요.",
        "이 라운드는 위험을 감수해볼게요.",
    ],
}

# 페르소나별 보조 문장 (테마 코멘트 뒤에 붙이거나 대체)
PERSONA_FLAVOR = {
    "전략적": ["전략적으로 골랐어요.", "포인트를 노려봅니다.", "이번 라운드 전략은 이거예요."],
    "감성적": ["감정적으로는 이쪽이에요.", "직감이 O를 가리켜요.", "마음이 이쪽으로 가요."],
    "보수적": ["안전한 쪽으로 갑니다.", "보수적으로 선택해요.", "리스크를 줄이는 쪽이에요."],
    "도전적": ["도전해볼게요.", "소수 쪽이 재밌을 것 같아요.", "위험을 감수해봅니다."],
    "논리적": ["논리적으로는 이쪽이에요.", "근거를 놓고 보면 O가 맞아요.", "설득력 있는 쪽으로 갑니다."],
}


def get_first_choice_comment(
    question: str,
    persona: str,
    choice: str,
    *,
    round_num: int | None = None,
    scoreboard: list[dict] | None = None,
    memory: dict | None = None,
    seed: int | None = None,
) -> str:
    """
    주제(질문)+페르소나+라운드 상황을 섞어서 'LLM처럼' 보이는 코멘트 생성.
    - round_num/scoreboard는 없으면 무시.
    - memory로 중복 최소화.
    """
    mem = memory or {}
    rng = random.Random(seed)
    style = _persona_style(persona)
    theme = _detect_theme(question)
    pool = list(COMMENTS_FIRST_BY_THEME.get(theme, COMMENTS_FIRST_BY_THEME["generic"]))

    # 라운드/점수 맥락을 한 줄로 추가(매번 다르게)
    context_bits: list[str] = []
    if isinstance(round_num, int) and round_num > 0:
        context_bits += [f"{round_num}R 기준으로", f"{round_num}라운드라", f"지금 라운드({round_num})는"]
    if scoreboard:
        try:
            # 내가 1등인지/추격인지 정도만 표현(너무 노골적인 숫자 반복 방지)
            top = scoreboard[0] if scoreboard else None
            if top and top.get("points") is not None:
                context_bits += ["리더보드 보면서", "점수판 보고", "순위 생각하면"]
        except Exception:
            pass

    base = _pick(rng, pool, mem, f"first:theme:{theme}")
    # 선택(O/X)에 대한 한 줄 (같은 선택도 표현 다양화)
    choice_bits = {
        "O": ["O로 갈게요", "O 쪽이 더 맞아 보임", "O에 한 표", "O로 찍음"],
        "X": ["X로 갈게요", "X 쪽이 더 설득됨", "X에 한 표", "X로 찍음"],
    }.get((choice or "O").upper(), ["그쪽으로 감"])
    cb = _pick(rng, choice_bits, mem, f"first:choice:{choice}")

    if context_bits and rng.random() < 0.65:
        ctx = _pick(rng, context_bits, mem, f"first:ctx")
        raw = f"{ctx} {base} 그래서 {cb}"
    else:
        raw = f"{base} 그래서 {cb}"

    # 20%는 페르소나 플레이버로 변주
    if rng.random() < 0.2:
        flavor = PERSONA_FLAVOR.get(style, PERSONA_FLAVOR["전략적"])
        raw = f"{_pick(rng, flavor, mem, f'first:flavor:{style}')} {cb}"

    out = _soften(raw, style, rng, mem)
    return _sanitize(out)


# --- 스위치 코멘트 (테마 무관, 페르소나만 약간 반영 가능) ---
COMMENTS_SWITCH_USE = [
    "소수 쪽으로 바꿀게요. 기회니까요.",
    "분포 보고 생각 바꿨어요.",
    "스위치 한 번 써볼게요.",
    "다수 쪽이었는데 소수로 갑니다.",
    "전략적으로 방향 전환해요.",
    "아깝지 않게 스위치 사용할게요.",
    "지금이 스위치 타이밍인 것 같아요.",
]
COMMENTS_SWITCH_SKIP = [
    "이대로 유지할게요.",
    "이미 소수 쪽이에요. 유지합니다.",
    "스위치는 다음에 쓸게요.",
    "지금 선택이 맞는 것 같아서 유지해요.",
    "스위치 아껴둘게요.",
    "이번 라운드는 그대로 갑니다.",
]


def get_switch_comment(
    use_switch: bool,
    persona: str,
    *,
    reveal: list[dict] | None = None,
    my_first: str | None = None,
    memory: dict | None = None,
    seed: int | None = None,
) -> str:
    """스위치 사용/미사용 코멘트. reveal 분포/내 선택을 짧게 반영해 자연스럽게."""
    mem = memory or {}
    rng = random.Random(seed)
    style = _persona_style(persona)

    pool = COMMENTS_SWITCH_USE if use_switch else COMMENTS_SWITCH_SKIP
    base = _pick(rng, list(pool), mem, f"switch:base:{'use' if use_switch else 'skip'}")

    dist_hint = ""
    if reveal:
        try:
            o = sum(1 for r in reveal if (r.get("choice") or "O") == "O")
            x = sum(1 for r in reveal if (r.get("choice") or "O") == "X")
            if o != x:
                dist_hint = _pick(rng, [f"분포가 O:{o} X:{x}라", f"O:{o}/X:{x}면", "분포 보고"], mem, "switch:dist")
        except Exception:
            dist_hint = ""

    if dist_hint and rng.random() < 0.7:
        raw = f"{dist_hint} {base}"
    else:
        raw = base

    if my_first in ("O", "X") and rng.random() < 0.45:
        raw += f" (처음은 {my_first}였음)"

    out = _soften(raw, style, rng, mem)
    return _sanitize(out)
