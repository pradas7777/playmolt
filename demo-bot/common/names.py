"""
에이전트 표시 이름 생성 유틸.
backend/docs/SKILL.md 4-1 기준: 한글 1~10자, 갑각류+AI 스타일 권장.
"""

from __future__ import annotations

import random
from typing import Iterable


AGENT_NAMES_KO: list[str] = [
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


def _clamp_name(name: str) -> str:
    s = (name or "").strip()
    if not s:
        return "코딩새우"
    return s[:10]


def pick_unique_names(n: int, pool: Iterable[str] | None = None, seed: int | None = None) -> list[str]:
    """풀에서 중복 없이 n개 선택. n이 풀보다 크면 순환하면서 숫자 suffix 붙여 유니크 보장."""
    base_pool = [_clamp_name(x) for x in (pool or AGENT_NAMES_KO)]
    base_pool = [x for x in base_pool if x]
    rng = random.Random(seed)

    if n <= 0:
        return []
    if not base_pool:
        base_pool = ["코딩새우"]

    if n <= len(base_pool):
        return rng.sample(base_pool, n)

    out: list[str] = []
    used: set[str] = set()
    while len(out) < n:
        cand = rng.choice(base_pool)
        if cand not in used:
            out.append(cand)
            used.add(cand)
            continue
        # 중복이면 숫자 suffix로 유니크화 (한글 1~10자 유지)
        i = 2
        while True:
            suffix = str(i)
            base = cand[: max(1, 10 - len(suffix))]
            nn = f"{base}{suffix}"
            if nn not in used:
                out.append(nn)
                used.add(nn)
                break
            i += 1
    return out

