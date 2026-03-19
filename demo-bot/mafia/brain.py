"""
마피아(Word Wolf) 봇 의사결정 로직.
목표: state/history를 반영해 '실제로 생각하는 LLM'처럼 보이는 힌트/의심/최종발언/투표를 생성.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path


REASON_CODES = ("AMBIGUOUS", "TOO_SPECIFIC", "OFF_TONE", "ETC")


@dataclass
class MafiaDecision:
    text: str | None = None
    target_id: str | None = None
    reason_code: str | None = None


_WORD_PAIRS: list[dict] | None = None
_PAIR_BY_WORD: dict[str, tuple[str, str]] | None = None  # word -> (citizen_word, wolf_word)


def _load_word_pairs() -> dict[str, tuple[str, str]]:
    """backend/app/data/word_pairs.json 로드해서 단어->(시민,늑대) 페어 맵 생성."""
    global _WORD_PAIRS, _PAIR_BY_WORD
    if _PAIR_BY_WORD is not None:
        return _PAIR_BY_WORD

    # demo-bot 기준으로 backend/app/data/word_pairs.json 찾기
    here = Path(__file__).resolve()
    repo_root = here.parents[2]  # .../playmolt
    path = repo_root / "backend" / "app" / "data" / "word_pairs.json"
    try:
        raw = path.read_text(encoding="utf-8")
        _WORD_PAIRS = json.loads(raw)
    except Exception:
        _WORD_PAIRS = []

    pair_by_word: dict[str, tuple[str, str]] = {}
    for item in _WORD_PAIRS or []:
        cw = (item.get("citizen_word") or item.get("common_word") or "").strip()
        ww = (item.get("wolf_word") or item.get("odd_word") or "").strip()
        if not cw or not ww:
            continue
        pair_by_word[cw] = (cw, ww)
        pair_by_word[ww] = (cw, ww)
    _PAIR_BY_WORD = pair_by_word
    return pair_by_word


def _domain_of_pair(cw: str, ww: str) -> str:
    s = f"{cw}/{ww}"
    # 브랜드/IT
    if any(k in s for k in ("삼성", "LG", "아이폰", "갤럭시", "에어팟", "버즈", "카카오톡", "라인", "유튜브", "넷플릭스", "쿠팡", "네이버")):
        return "브랜드/서비스"
    # 음식/디저트
    if any(k in s for k in ("찌개", "콜라", "사이다", "닭갈비", "제육", "아이스크림", "빙수", "케이크", "티라미수", "파스타", "피자")):
        return "음식"
    # 장소
    if any(k in s for k in ("제주", "부산", "서울", "경기", "한강", "청계천")):
        return "장소"
    # 스포츠/레저
    if any(k in s for k in ("야구", "농구", "스키", "보드")):
        return "스포츠/레저"
    # 관계/연애
    if any(k in s for k in ("솔로", "커플", "썸", "연애", "고백", "키스", "포옹", "전", "현", "애인", "짝사랑", "바람", "환승", "프로포즈", "결혼", "동거")):
        return "연애/관계"
    # 학교/일상
    if any(k in s for k in ("기말", "방학", "지각", "조퇴", "과탑", "재수강", "MT", "OT")):
        return "학교/일상"
    # 생활/라이프
    if any(k in s for k in ("퇴근", "출근", "월급", "용돈", "통장", "카드값", "연말정산", "세금")):
        return "돈/직장"
    # 성향/밈
    if any(k in s for k in ("인싸", "집순", "찐따", "현타", "자존감", "헬창", "멸치", "술고래", "알쓰", "다이어트", "폭식", "야식", "금식")):
        return "밈/라이프"
    return "일반"


def _persona_style(persona: str) -> str:
    p = (persona or "").strip()
    if "감성" in p:
        return "감성적"
    if "보수" in p:
        return "보수적"
    if "도전" in p:
        return "도전적"
    if "논리" in p:
        return "논리적"
    return "전략적"


def _safe100(s: str) -> str:
    return (s or "")[:100]


def _safe_final(s: str) -> str:
    # final: 40~140자
    s = (s or "").strip()
    if len(s) < 40:
        s = (s + " " + "추론 근거 남김" * 6).strip()
    return s[:140]


def _extract_hints(history: list[dict]) -> list[dict]:
    for item in reversed(history or []):
        if item.get("phase") == "hint":
            return item.get("hints") or []
    return []


def _normalize_text(s: str) -> str:
    return " ".join((s or "").strip().split())


def _quote(s: str, n: int = 28) -> str:
    t = _normalize_text(s)
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


def _specificity_score(text: str) -> int:
    """
    힌트가 얼마나 좁은지 대략 점수화.
    - 브랜드/지명/직격 고유명사 계열이면 점수 크게 증가
    - 너무 짧거나 메타 문구 위주면 모호(AMBIGUOUS) 후보
    """
    t = _normalize_text(text)
    if not t:
        return 0
    score = 0
    if len(t) <= 8:
        score += 1
    if any(k in t for k in ("서울", "부산", "제주", "한강", "청계천")):
        score += 4
    if any(k in t for k in ("삼성", "LG", "아이폰", "갤럭시", "카카오톡", "유튜브", "넷플릭스", "쿠팡", "네이버")):
        score += 5
    if any(k in t for k in ("정답", "그 단어", "말하면", "바로 들킴", "힌트", "범주", "의미권")):
        score += 1
    if len(t) >= 45:
        score += 1
    return score


def _tone_flags(text: str) -> set[str]:
    t = _normalize_text(text)
    out = set()
    if any(k in t for k in ("ㅋㅋ", "ㅎ", "ㄷ", "ㅠ", "ㅜ")):
        out.add("emoji_like")
    if any(k in t for k in ("!", "??", "!!!")):
        out.add("excited")
    return out


def _infer_domain_from_hint(text: str) -> str:
    t = _normalize_text(text)
    if not t:
        return "일반"
    if any(k in t for k in ("브랜드", "서비스", "플랫폼", "앱", "구독", "알림", "결제", "폰", "스마트", "전자")):
        return "브랜드/서비스"
    if any(k in t for k in ("메뉴", "맛", "국물", "매운", "구수", "디저트", "음료", "배고", "먹", "식")):
        return "음식"
    if any(k in t for k in ("도시", "여행", "지도", "지역", "랜드마크", "산책", "강", "바다")):
        return "장소"
    if any(k in t for k in ("운동", "종목", "시즌", "장비", "레저", "스포츠", "경기")):
        return "스포츠/레저"
    if any(k in t for k in ("연애", "관계", "애인", "짝사랑", "고백", "이별", "커플", "솔로", "썸", "환승")):
        return "연애/관계"
    if any(k in t for k in ("학기", "학교", "수업", "시험", "방학", "오티", "엠티", "과제")):
        return "학교/일상"
    if any(k in t for k in ("출근", "퇴근", "월급", "통장", "카드", "세금", "정산", "직장")):
        return "돈/직장"
    if any(k in t for k in ("밈", "유행", "SNS", "자기관리", "헬스", "다이어트", "폭식", "인싸", "집순")):
        return "밈/라이프"
    return "일반"


def _consensus_domain(hints: list[dict]) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    for h in hints or []:
        d = _infer_domain_from_hint(h.get("text") or "")
        counts[d] = counts.get(d, 0) + 1
    if not counts:
        return "일반", {}
    best = max(counts.items(), key=lambda x: x[1])[0]
    return best, counts


def _accusation_tally(history: list[dict]) -> dict[str, int]:
    """가장 최근 suspect 단계에서 '누가 몇 번 지목됐는지' 카운트."""
    last_suspect = next((h for h in reversed(history or []) if h.get("phase") == "suspect"), None)
    counts: dict[str, int] = {}
    if not last_suspect:
        return counts
    for s in last_suspect.get("suspects") or []:
        tid = s.get("target_id")
        if not tid:
            continue
        counts[tid] = counts.get(tid, 0) + 1
    return counts


def _wolfiness_estimate(state: dict, persona: str, memory: dict) -> float:
    """
    단판에서 '내가 늑대일 가능성'을 엔진 규칙에 어긋나지 않는 선에서 추정.
    - 역할은 state에서 숨겨져(UNKNOWN) 있으니, 힌트 컨센서스와 내 힌트의 결 차이를 이용한다.
    - 늑대라고 가정될수록: 다수 의견에 0.5박자 늦게 합류(표/지목 수렴), 프레이밍(쉬운 희생양) 강화.
    """
    style = _persona_style(persona)
    history = state.get("history", []) or []
    hints = _extract_hints(history)
    my_id = (state.get("self", {}) or {}).get("id")
    my_hint = next((h.get("text") for h in hints if h.get("agent_id") == my_id), "") or ""

    consensus, counts = _consensus_domain(hints)
    my_domain = _infer_domain_from_hint(my_hint) if my_hint else "일반"
    if my_domain == "일반":
        # 힌트가 없거나 도메인 추정이 애매하면 '내 단어 도메인'으로 보정(너무 직격은 아님)
        secret = (state.get("self", {}) or {}).get("secretWord", "") or ""
        pair_map = _load_word_pairs()
        cw, ww = pair_map.get(secret.strip(), ("", ""))
        my_domain = _domain_of_pair(cw or secret, ww or secret)

    # 내 힌트가 컨센서스에서 벗어날수록 늑대 가능성을 올림
    outlier = 1.0 if (consensus != "일반" and my_domain != "일반" and my_domain != consensus) else 0.0

    # 사람들이 나를 찍는 흐름(최근 suspect에서 나를 지목한 표 수)
    accused_counts = _accusation_tally(history)
    accused_me = float(accused_counts.get(my_id, 0))

    # 힌트의 특이성: 너무 극단이면(너무 특정/너무 모호) 늑대일 가능성에 약간 가중
    spec = float(_specificity_score(my_hint)) if my_hint else 0.0
    extreme = 1.0 if (spec >= 6 or (my_hint and len(_normalize_text(my_hint)) <= 8)) else 0.0

    # 페르소나별 약간의 편향(도전적/감성적은 더 즉흥적으로 "연막/드라마"를 탄다)
    style_bias = 0.08 if style in ("도전적", "감성적") else 0.0

    # 0~1로 클램프되는 간단한 결합
    # outlier(0/1) + accused_me(0~4 정도) + extreme(0/1)
    raw = 0.25 + 0.35 * outlier + 0.12 * min(4.0, accused_me) + 0.18 * extreme + style_bias
    return max(0.0, min(1.0, raw))


def _suspicion_table(state: dict, memory: dict) -> dict[str, float]:
    """
    단판 최적화 '심리적 의심 점수' (최근 이벤트만 반영).
    - 나를 지목/투표한 사람: 즉시 의심 +
    - 내가 지목했던 타깃을 같이 찍은 사람: 아주 약한 신뢰(의심 -)
    - 장기 누적/감쇠/결과 기반 재평가는 하지 않음 (단판이라 과투자 방지)
    """
    history = state.get("history", []) or []
    me_id = (state.get("self", {}) or {}).get("id")
    # 단판: 호출 시점마다 "최근 로그"로만 점수 구성
    mem_susp: dict[str, float] = {}

    last_my_suspect = memory.get("last_suspect_target_id")

    # 단판: 가장 최근 suspect 라운드만 반영 (투표 정보는 투표 전엔 알 수 없음)
    last_suspect = next((h for h in reversed(history) if h.get("phase") == "suspect"), None)

    if last_suspect:
        for s in last_suspect.get("suspects") or []:
            voter = s.get("agent_id")
            target = s.get("target_id")
            if not voter or not target or voter == me_id:
                continue
            if target == me_id:
                # 나를 직접 의심한 사람: 심리적으로 크게 걸러짐
                mem_susp[voter] = mem_susp.get(voter, 0.0) + 2.5
            elif last_my_suspect and target == last_my_suspect:
                # 나와 같은 타깃을 본 사람: 살짝 신뢰
                mem_susp[voter] = mem_susp.get(voter, 0.0) - 0.8

    # 디버그/일관성용으로만 저장 (다음 호출에서 누적 사용하지 않음)
    memory["suspicion"] = dict(mem_susp)
    return mem_susp

def _build_hint(secret_word: str, style: str, memory: dict) -> str:
    """
    단어 의미를 100% 이해하진 못하더라도, 페어 데이터 기반 '도메인'을 활용해
    훨씬 자연스럽고 다양한 힌트를 생성.
    """
    w = (secret_word or "").strip()
    pair_map = _load_word_pairs()
    cw, ww = pair_map.get(w, ("", ""))
    domain = _domain_of_pair(cw or w, ww or w)

    # 같은 봇이 같은 방식/표현을 반복하지 않도록 memory 사용
    used = memory.setdefault("used_hint_modes", set())
    recent_texts: list[str] = memory.setdefault("recent_hint_texts", [])

    # 메타 티가 나는 단어는 가급적 피함(리플레이 자연스러움 위해)
    forbidden_substrings = (
        "힌트",
        "범주",
        "의미권",
        "정답",
        "그 단어",
        "바로 들킴",
        "게임",
        "늑대",
        "시민",
        "워드울프",
    )

    def pick(items: list[str], mem_key: str, avoid_recent: int = 6) -> str:
        used_list: list[str] = memory.setdefault(mem_key, [])
        candidates = [x for x in items if x not in used_list[-avoid_recent:]] or items
        v = random.choice(candidates)
        used_list.append(v)
        return v

    # 생성 결과가 금지어를 포함하면 재시도
    def acceptable(text: str) -> bool:
        t = _normalize_text(text)
        if not t:
            return False
        if any(x in t for x in forbidden_substrings):
            return False
        if t in recent_texts[-10:]:
            return False
        return True

    modes = [
        "category",
        "scene",
        "contrast",
        "boundary",
        "metaphor",
        "soft_disclaimer",
        "process",       # 사고 과정 한 줄
        "negative_space" # '이건 아니다'를 말하진 않고 경계만
    ]
    # 매번 다른 스타일이 섞이도록
    mode = random.choice([m for m in modes if m not in used] or modes)
    used.add(mode)

    # 도메인별 소재 풀
    category_pool = {
        "브랜드/서비스": ["국내/글로벌 브랜드", "스마트폰/전자기기", "앱/플랫폼", "생활형 서비스"],
        "음식": ["메뉴/음식", "매운/담백 같은 맛의 축", "집밥 vs 외식 감성", "디저트/음료"],
        "장소": ["여행지/도시", "산책 코스", "지역명", "랜드마크"],
        "스포츠/레저": ["겨울/여름 레저", "구기 스포츠", "취미 활동", "운동 종목"],
        "연애/관계": ["관계 상태", "연애 이벤트", "감정선", "사람 사이 규칙"],
        "학교/일상": ["대학생활 키워드", "학사 일정", "학교 문화", "행사/오리엔테이션"],
        "돈/직장": ["직장 생활", "돈/정산", "생활비", "루틴(출근/퇴근)"],
        "밈/라이프": ["밈/유행어", "라이프스타일", "자기관리", "사회적 성향"],
        "일반": ["일상 단어", "자주 듣는 표현", "상황 단서", "느낌/이미지"],
    }
    scenes = {
        "브랜드/서비스": ["폰 만지다 보면 떠오름", "알림/결제/구독 같은 맥락임", "일상에서 자연스럽게 쓰임"],
        "음식": ["배고플 때 떠오름", "메뉴 고를 때 고민되는 축임", "집에서 vs 밖에서 선택 갈림"],
        "장소": ["지도 보면 바로 나옴", "주말 나들이로 많이 언급됨", "사람들이 '가자'라고 말함"],
        "스포츠/레저": ["시즌 타면 자주 언급됨", "장비/복장 연상됨", "취미 얘기에서 튀어나옴"],
        "연애/관계": ["톡방에서 많이 나옴", "사람 성향에 따라 호불호 갈림", "경험담이 많은 주제임"],
        "학교/일상": ["단체방에서 빈번함", "학기 초/말에 특히 나옴", "다들 한 번은 겪는 것임"],
        "돈/직장": ["월말/연말에 특히 나옴", "듣기만 해도 피곤해짐", "현실 파트임"],
        "밈/라이프": ["자조/드립으로 많이 씀", "SNS에 흔함", "자기소개에 자주 붙음"],
        "일반": ["말만 들어도 그림이 그려짐", "일상에서 의외로 자주 쓰임", "설명하면 너무 쉬워질 것임"],
    }

    cat = random.choice(category_pool.get(domain, category_pool["일반"]))
    scene = random.choice(scenes.get(domain, scenes["일반"]))

    # 문장 템플릿(길고 자연스럽게, 그래도 100자 이내)
    if mode == "category":
        tpls = [
            f"큰 카테고리는 '{cat}' 쪽임. 너무 좁히진 않고 방향만 던져둠",
            f"{cat} 쪽으로 생각하면 됨. 구체명사로 찍기보단 감만 공유하겠음",
        ]
    elif mode == "scene":
        tpls = [
            f"장면으로 말하면 {scene}. 그 맥락에서 자연스럽게 떠오르는 타입임",
            f"{scene} 같은 상황에서 자주 튀어나오는 말임. 너무 박아넣진 않겠음",
        ]
    elif mode == "contrast":
        # 페어를 아는 경우에만 'A vs B' 축을 살짝 암시 (너무 구체적 단어는 말하지 않음)
        axis_pool = {
            "음식": ["매운 vs 구수", "국물 vs 비빔", "간편 vs 푸짐"],
            "브랜드/서비스": ["국산 vs 경쟁사", "폐쇄형 vs 개방형", "기기 vs 서비스"],
            "장소": ["섬/바다 vs 도시", "강 vs 도심 하천", "광역권 vs 특정 지역"],
            "연애/관계": ["시작 vs 끝", "공개 vs 비공개", "현재 vs 과거"],
        }
        axis = random.choice(axis_pool.get(domain, ["A vs B"]))
        tpls = [
            f"이건 '{axis}' 같은 대비축 위에 놓이는 말임. 대중이 어느 쪽으로 기울지 떠올리면 됨",
            f"같은 카테고리 안에서 성격이 갈리는 타입임. '{axis}'처럼 축이 있음",
        ]
    elif mode == "boundary":
        tpls = [
            "너무 고유명사로 찍으면 흐름이 깨짐. 기능/역할/느낌만 남겨두겠음",
            "정보량을 과하게 주면 금방 수렴함. 방향만 두고 나머진 각자 추론하길",
        ]
    elif mode == "metaphor":
        tpls = [
            f"비유하면 '{cat}' 쪽에서 자주 등장하는 대표 선수 같은 말임",
            f"비유로만 말하면, {cat} 세계의 '기본값' 같은 느낌임",
        ]
    elif mode == "process":
        tpls = [
            f"나는 {cat} 쪽으로 먼저 좁히고, 그 다음에 {scene} 같은 장면을 떠올리는 편임",
            f"{scene} → {cat} 순서로 생각하면 자연스럽게 후보가 줄어드는 타입임",
        ]
    elif mode == "negative_space":
        tpls = [
            f"이건 딱딱한 전문용어 느낌은 아님. {cat} 쪽의 생활형 단어에 가까움",
            f"{scene}처럼 너무 특별한 이벤트 단어는 아님. 오히려 {cat} 쪽에서 자주 보임",
        ]
    else:  # soft_disclaimer
        tpls = [
            f"너무 직설적이진 않게 {cat} 정도만 던져둠. 각자 결을 맞춰보면 됨",
            f"{cat} 느낌으로만 잡아두면 됨. 더 좁히면 누가 봐도 답이 나옴",
        ]

    # 페르소나별 말버릇(어미/연결어) 다양화
    connective = {
        "감성적": ["왠지", "체감상", "느낌상", "묘하게"],
        "논리적": ["전제부터", "구조적으로", "정의상", "추론하면"],
        "도전적": ["과감하게", "일단 던지면", "재밌게", "한 번"],
        "보수적": ["조심스럽게", "무난하게", "안전하게", "흔들지 않고"],
        "전략적": ["확률적으로", "상대 반응 보면", "일단", "대체로"],
    }.get(style, ["일단"])

    prefix_pool = [
        f"{pick(connective, f'connective:{style}')}",
        "",
    ]
    prefix = pick(prefix_pool, f"prefix:{style}")

    text = pick(tpls, f"tpl:{domain}:{mode}")
    if prefix:
        # 접두가 들어가도 자연스러운 형태로
        text = f"{prefix} {text}".strip()

    # 페르소나 톤 한 스푼 추가
    if style == "감성적":
        text += pick([". 떠오르는 장면이 있음", ". 묘하게 익숙한 쪽임", ". 말로 하면 뻔해질까봐 여기까지만"], f"tail:{style}")
    elif style == "논리적":
        text += pick([". 상위개념부터 내려오면 수렴함", ". 정의역을 줄이면 후보가 줄어듦", ". 축을 잡으면 갈림이 보임"], f"tail:{style}")
    elif style == "도전적":
        text += pick([". 이 정도는 감수함", ". 여기서 더 가면 너무 노골적임", ". 살짝만 던져두겠음"], f"tail:{style}")
    elif style == "보수적":
        text += pick([". 더는 안 좁힘", ". 여기까지가 안전선임", ". 과하게 주면 바로 수렴함"], f"tail:{style}")
    else:
        text += pick([".", ". 방향만 잡겠음", ". 각자 결 맞춰보길"], f"tail:{style}")

    # 금지어/중복 회피를 위해 최대 6회 재시도
    for _ in range(6):
        out = _safe100(text)
        if acceptable(out):
            recent_texts.append(out)
            return out
        # 다른 mode로 재시도
        mode2 = random.choice(modes)
        used.add(mode2)
        text = pick(tpls, f"tpl_retry:{domain}:{mode2}")
        if prefix:
            text = f"{prefix} {text}".strip()
    # 최후 폴백: 금지어를 제거(최대한 자연스럽게 유지)
    out = _safe100(text)
    for bad in forbidden_substrings:
        out = out.replace(bad, "")
    out = _safe100(_normalize_text(out))
    recent_texts.append(out)
    return out


def decide_hint(state: dict, persona: str, memory: dict | None = None) -> MafiaDecision:
    style = _persona_style(persona)
    secret = (state.get("self", {}) or {}).get("secretWord", "") or ""
    mem = memory or {}
    return MafiaDecision(text=_build_hint(secret, style, mem))


def decide_suspect(state: dict, persona: str, memory: dict | None = None) -> MafiaDecision:
    style = _persona_style(persona)
    participants = state.get("participants", []) or []
    me_id = (state.get("self", {}) or {}).get("id")
    hints = _extract_hints(state.get("history", []) or [])
    mem = memory or {}

    # 심리전: 나를 때렸던/도와줬던 사람들에 대한 내부 의심 테이블
    susp = _suspicion_table(state, mem)
    wolfy = _wolfiness_estimate(state, persona, mem)

    # 힌트 기반 점수: 너무 짧거나(무책임) / 너무 특정(브랜드·지명 직격) / 분위기 어긋남
    hint_by_id = {h.get("agent_id"): (h.get("text") or "") for h in hints}
    consensus, counts = _consensus_domain(hints)

    def score(pid: str) -> tuple[float, int, int, int]:
        t = (hint_by_id.get(pid) or "").strip()
        s: float = 0.0  # suspicious score
        if not t:
            s += 3
        spec = _specificity_score(t)
        if len(_normalize_text(t)) <= 8:
            s += 2
        if spec >= 5:
            s += 3  # 너무 특정
        if "emoji_like" in _tone_flags(t):
            s += 1
        d = _infer_domain_from_hint(t)
        domain_outlier = 1 if (consensus != "일반" and d != "일반" and d != consensus) else 0
        s += 2 * domain_outlier
        if any(k in t for k in ("정답", "그 단어", "말하면", "바로 들킴", "힌트", "범주", "의미권")):
            s += 1
        # 단판 심리전:
        # - 시민 모드(늑대 가능성 낮음): '나를 찍은 사람'에 대한 반응을 약간 더 반영
        # - 늑대 모드(늑대 가능성 높음): 감정 반응(복수)을 줄이고 "설득력 있는 희생양"을 고르는 쪽으로
        if wolfy < 0.55:
            s += susp.get(pid, 0.0)
            if style in ("도전적", "감성적"):
                s += 0.5 * susp.get(pid, 0.0)
        else:
            s += 0.25 * susp.get(pid, 0.0)
        return (s, domain_outlier, int(round(susp.get(pid, 0.0) * 10)), random.randint(0, 1000))

    others = [p for p in participants if p.get("id") and p.get("id") != me_id]
    if not others:
        return MafiaDecision(target_id=None, reason_code="ETC")

    if hints:
        target = max(others, key=lambda p: score(p["id"]))
    else:
        target = random.choice(others)

    # reason_code 선택
    t = (hint_by_id.get(target["id"]) or "").strip()
    if not t or len(t) <= 8:
        reason = "AMBIGUOUS"
    elif any(k in t for k in ("서울", "부산", "삼성", "LG", "아이폰", "갤럭시", "카카오톡", "유튜브", "넷플릭스", "쿠팡", "네이버")):
        reason = "TOO_SPECIFIC"
    elif any(k in t for k in ("ㅋㅋ", "ㅎ", "ㄷ", "ㅠ", "ㅜ")):
        reason = "OFF_TONE"
    else:
        d = _infer_domain_from_hint(t)
        reason = "ETC" if (consensus != "일반" and d != "일반" and d != consensus) else random.choice(REASON_CODES)

    mem["last_suspect_target_id"] = target["id"]
    mem["last_suspect_reason"] = reason
    mem["consensus_domain"] = consensus
    mem["domain_counts"] = counts
    mem["wolfiness"] = wolfy

    return MafiaDecision(target_id=target["id"], reason_code=reason)


def decide_final(state: dict, persona: str, memory: dict | None = None) -> MafiaDecision:
    style = _persona_style(persona)
    secret = (state.get("self", {}) or {}).get("secretWord", "") or ""
    hints = _extract_hints(state.get("history", []) or [])
    my_hint = next((h.get("text") for h in hints if h.get("agent_id") == (state.get("self", {}) or {}).get("id")), None)
    base = my_hint or _build_hint(secret, style, memory={})
    mem = memory or {}

    # history 기반으로 '특정인 지목'까지 자연스럽게 넣기
    suspect_item = next((h for h in reversed(state.get("history", []) or []) if h.get("phase") == "suspect"), None) or {}
    suspects = suspect_item.get("suspects") or []
    my_id = (state.get("self", {}) or {}).get("id")
    i_accused = next((s for s in suspects if s.get("agent_id") == my_id), None)
    accused_name = i_accused.get("target_name") if i_accused else None
    accused_reason = i_accused.get("reason_code") if i_accused else None
    consensus = mem.get("consensus_domain") or _consensus_domain(hints)[0]

    # 다른 사람 힌트 1~2개 인용(짧게)
    others = [h for h in hints if h.get("agent_id") != my_id]
    random.shuffle(others)
    cited = []
    for h in others[:2]:
        nm = (h.get("name") or h.get("agent_id") or "")[:6]
        cited.append(f"{nm}='{_quote(h.get('text') or '')}'")
    cite_txt = (" 다른 힌트로는 " + ", ".join(cited) + " 정도 있었음.") if cited else ""

    tail_pool = [
        "투표는 '너무 좁거나 너무 넓은 힌트'를 기준으로 해주면 됨",
        "지금 단계에서 중요한 건 힌트의 방향성(의미권) 일치 여부임",
        "브랜드/지명 같은 직격 힌트는 늑대가 무리했을 가능성도 큼",
        "일관성 없는 힌트가 가장 위험함. 말의 톤과 정보량을 같이 봐주길 바람",
        "내 힌트는 일부러 중간 정보량으로 잡았음. 너무 안전하면 늑대가 편해짐",
        f"다수는 '{consensus}' 쪽으로 모이는 느낌이었음. 거기서 튀는 쪽을 다시 보면 됨" if consensus else "다수 의미권이 어디로 모이는지 먼저 보길 바람",
    ]
    if style == "감성적":
        tail_pool += [
            "분위기상 억울하지만, 말의 결은 시민 쪽임",
            "느낌이 아니라 정합성으로 봐주길 바람. 감정적으로 몰아가면 늑대만 웃음",
        ]
    elif style == "도전적":
        tail_pool += [
            "늑대는 보통 안전한 말만 던짐. 과하게 무난한 힌트도 의심해보길 바람",
            "누군가 너무 중립이면 오히려 연막일 수 있음. 다들 한 번 더 체크하길 바람",
        ]
    elif style == "논리적":
        tail_pool += [
            "힌트의 정보량(범주 폭)과 방향성(축)을 비교하면 후보가 좁혀짐",
            "과도하게 일반화한 힌트는 의도적 연막일 수 있음. 반대로 직격은 무리수임",
        ]

    focus = ""
    if accused_name and accused_reason:
        focus = f" 내가 찍은 쪽은 {accused_name}({accused_reason})였고, 그 힌트가 특히 튄다고 봤음."
    # 심리전(단판): 직전 suspect에서 누가 나를 지목했는지 정도만 언급
    susp = _suspicion_table(state, mem)
    high_susp = sorted([(pid, v) for pid, v in susp.items() if v > 1.5], key=lambda x: -x[1])
    if high_susp:
        worst_id, _ = high_susp[0]
        worst_name = next((p.get("name") for p in (state.get("participants") or []) if p.get("id") == worst_id), worst_id)
        focus_extra = f" 특히 {worst_name} 쪽에서 나를 찍는 흐름이 있었는데, 그 부분은 한 번 더 생각해볼 만함."
    else:
        focus_extra = ""

    # 늑대 연막(추정): 다수 흐름(지목 수렴)에 0.5박자 늦게 '합류'하는 말투
    wolfy = _wolfiness_estimate(state, persona, mem)
    acc_counts = _accusation_tally(state.get("history", []) or [])
    if wolfy >= 0.6 and acc_counts:
        # 가장 많이 지목된 타깃을 '검증 대상'으로 올려두는 문장
        top_tid = max(acc_counts.items(), key=lambda x: x[1])[0]
        top_name = next((p.get("name") for p in (state.get("participants") or []) if p.get("id") == top_tid), top_tid)
        follow_line = f" 그리고 지금은 {top_name} 쪽으로 시선이 모이는 게 보여서, 그 결을 무시하긴 어렵다고 봄."
    else:
        follow_line = ""

    text = f"내 힌트는 '{base}'였음.{cite_txt}{focus}{focus_extra}{follow_line} {random.choice(tail_pool)}."
    return MafiaDecision(text=_safe_final(text))


def decide_vote(state: dict, memory: dict | None = None) -> MafiaDecision:
    participants = state.get("participants", []) or []
    me_id = (state.get("self", {}) or {}).get("id")
    revote_candidates = state.get("revote_candidates", []) or []
    mem = memory or {}

    susp = _suspicion_table(state, mem)
    wolfy = _wolfiness_estimate(state, (mem.get("persona") or "전략적"), mem) if isinstance(mem.get("persona"), str) else _wolfiness_estimate(state, "전략적", mem)

    if revote_candidates:
        options = [c for c in revote_candidates if c != me_id]
        if options:
            last = mem.get("last_suspect_target_id")
            # 1순위: 내가 이미 지목했던 대상
            if last in options:
                return MafiaDecision(target_id=last)

            # 2순위: (단판) 힌트 기반 점수 중심, 시민일수록 심리 점수 가중
            def revote_score(pid: str) -> tuple[float, int]:
                base, _ = vote_score(pid)
                s = float(base) + (susp.get(pid, 0.0) * (1.5 if wolfy < 0.55 else 0.4))
                return (s, random.randint(0, 1000))

            best = max(options, key=lambda pid: revote_score(pid))
            return MafiaDecision(target_id=best)

    last = mem.get("last_suspect_target_id")
    options = [p.get("id") for p in participants if p.get("id") and p.get("id") != me_id]
    if last in options:
        return MafiaDecision(target_id=last)

    hints = _extract_hints(state.get("history", []) or [])
    hint_by_id = {h.get("agent_id"): (h.get("text") or "") for h in hints}
    consensus, _ = _consensus_domain(hints)

    def vote_score(pid: str) -> tuple[float, int]:
        t = hint_by_id.get(pid, "")
        spec = _specificity_score(t)
        d = _infer_domain_from_hint(t)
        outlier = 1 if (consensus != "일반" and d != "일반" and d != consensus) else 0
        s: float = 0.0
        s += 3 if spec >= 5 else 0
        s += 2 * outlier
        s += 1 if (not _normalize_text(t) or len(_normalize_text(t)) <= 8) else 0
        # 투표는 '정보 기반'이 우선. 시민일수록 심리 반응을 더 싣고,
        # 늑대 추정이면 다수 수렴/설득력(쉬운 희생양) 쪽으로 간다.
        s += susp.get(pid, 0.0) * (1.0 if wolfy < 0.55 else 0.25)
        return (s, random.randint(0, 1000))

    if options:
        # 늑대 연막(추정): vote에서는 "가장 많이 지목된 타깃"에 0.5박자 늦게 합류하는 경향
        if wolfy >= 0.6:
            acc = _accusation_tally(state.get("history", []) or [])
            acc_options = {pid: acc.get(pid, 0) for pid in options}
            top_acc = max(acc_options.values()) if acc_options else 0
            if top_acc > 0:
                top_ids = [pid for pid, c in acc_options.items() if c == top_acc]
                # 동점이면 vote_score로 타이브레이크
                target = max(top_ids, key=lambda pid: vote_score(pid))
                return MafiaDecision(target_id=target)

        target = max(options, key=lambda pid: vote_score(pid))
        return MafiaDecision(target_id=target)
    return MafiaDecision(target_id=None)

