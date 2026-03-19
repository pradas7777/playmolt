"""
Trial(모의재판) 봇 의사결정 로직.
목표: expected_action + history를 반영해 'LLM처럼' 보이는 주장/요약/질문/평결을 생성.
"""

from __future__ import annotations

import random


def _clip(s: str, n: int) -> str:
    return (s or "")[:n]

def _norm(s: str) -> str:
    return " ".join((s or "").strip().split())


def _pick(items: list[str], memory: dict, key: str, *, avoid_recent: int = 6) -> str:
    if not items:
        return ""
    used: list[str] = memory.setdefault(key, [])
    candidates = [x for x in items if x not in used[-avoid_recent:]] or items
    v = random.choice(candidates)
    used.append(v)
    return v


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


def _quote(s: str, n: int = 42) -> str:
    t = _norm(s)
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"

def _case_topic(case: dict) -> tuple[str, str]:
    """사건 주제(제목/설명)를 안전하게 뽑아, 발언에 자연스럽게 섞기 위한 요약."""
    title = _norm((case or {}).get("title", ""))
    desc = _norm((case or {}).get("description", ""))
    return (title[:40], desc[:60])


def _case_issue(case: dict) -> str:
    """
    케이스 주제를 키워드로 분류해서(단판/데모용) 프레이밍을 더 '주제 맞게' 바꿈.
    반환값은 내부 태그이며, 엔진/프론트와 무관한 봇 내부 로직임.
    """
    # 데이터에 명시 태그가 있으면(정답) 그걸 최우선으로 사용 → 주제 오판 방지
    explicit = (case or {}).get("issue_tag")
    if isinstance(explicit, str) and explicit.strip():
        tag = explicit.strip()
        allowed = {
            "copyright_ai",
            "privacy",
            "fraud",
            "violence",
            "medical",
            "workplace",
            "rights_bias",
            "contract",
            "general",
        }
        if tag in allowed:
            return tag

    title, desc = _case_topic(case or {})
    t = _norm(f"{title} {desc}").lower()
    # AI/저작권/데이터
    if any(k in t for k in ("저작", "저작권", "학습데이터", "학습 데이터", "생성", "모델", "데이터셋")):
        return "copyright_ai"
    if any(k in t for k in ("개인정보", "프라이버시", "감시", "cctv", "위치", "생체", "얼굴", "동의", "고지")):
        return "privacy"
    if any(k in t for k in ("사기", "편취", "보이스피싱", "보험금", "환불", "거래", "투자", "다단계")):
        return "fraud"
    if any(k in t for k in ("폭행", "상해", "살인", "협박", "스토킹", "성범죄", "강요", "폭력")):
        return "violence"
    if any(k in t for k in ("의료", "수술", "진단", "약", "부작용", "사망", "병원", "치료")):
        return "medical"
    if any(k in t for k in ("근로", "직장", "해고", "임금", "산재", "노동", "괴롭힘")):
        return "workplace"
    if any(k in t for k in ("차별", "편향", "혐오", "평등", "위헌", "인권")):
        return "rights_bias"
    if any(k in t for k in ("계약", "약관", "대금", "위약", "채무", "보증", "임대", "소송")):
        return "contract"
    return "general"
def _evidence_points(ev_key: str, role: str, style: str, memory: dict) -> str:
    """
    evidence_key 텍스트에서 키워드를 잡아, 주장에 '내용상 근거'가 붙어 보이게 하는 짧은 논증 생성.
    - role: PROSECUTOR/DEFENSE
    - style: 페르소나
    """
    t = _norm(ev_key)
    if not t:
        return ""

    # 키워드 기반 주제 스니펫. 너무 길어지지 않게 1~2문장.
    # 같은 키워드라도 패턴을 여러 개 준비해 반복감 최소화.
    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"ev:{k}:{role}:{style}", avoid_recent=6)

    # 공통 키워드 집합
    if any(k in t for k in ("계약", "약관", "서류", "혼인", "등록", "고지서")):
        if role == "PROSECUTOR":
            return P(
                [
                    "계약/서류는 행위의 외형을 고정함. 당사자 의사와 법적 효과가 연결되는 지점임",
                    "서면 기록이 남는 유형이라 책임 회피가 어려움. 문서가 사실관계의 뼈대가 됨",
                ],
                "contract",
            )
        return P(
            [
                "계약/서류는 해석의 여지가 큼. 문구가 곧바로 위법성/책임을 확정하진 않음",
                "약관/서류가 존재해도 동의의 실질과 고지의 적정성이 핵심임",
            ],
            "contract",
        )

    if any(k in t for k in ("로그", "기록", "CCTV", "동선", "접속", "수정")):
        if role == "PROSECUTOR":
            return P(
                [
                    "기록/로그는 시점과 접근 가능성을 잡아줌. 우연 설명보다 인과 설명이 강해짐",
                    "로그가 반복적으로 일치하면 '패턴'이 됨. 단발 우연로 보기 어려워짐",
                ],
                "log",
            )
        return P(
            [
                "로그/기록은 누락·오염·대체 경로 가능성이 있음. 기록=행위자 단정은 위험함",
                "기록은 정황일 뿐, 동기/의도까지 자동으로 증명하진 않음",
            ],
            "log",
        )

    if any(k in t for k in ("DNA", "유전자", "동일", "복제")):
        if role == "PROSECUTOR":
            return P(
                [
                    "동일성(DNA/유전자)은 사실관계를 강하게 고정함. 우연보다 구조적 행위 가능성이 큼",
                    "복제/동일성은 의도적 개입 없이는 설명이 어려움. 책임 주체를 특정하기 쉬워짐",
                ],
                "dna",
            )
        return P(
            [
                "동일성(DNA)은 존재/동일인을 뜻할 수 있지만, 곧바로 동일 책임·동일 의무로 연결되진 않음",
                "복제 이슈는 법적 공백이 자주 생김. 행위를 비난해도 범죄구성요건 충족은 별개임",
            ],
            "dna",
        )

    if any(k in t for k in ("위헌", "인권", "평등", "자유", "침해", "선택권")):
        if role == "PROSECUTOR":
            return P(
                [
                    "권리 침해가 확인되면 정당화 사유가 필요함. 목적이 있어도 수단의 과잉 여부가 쟁점임",
                    "평등/자유 침해는 단순 효율 논리로 덮기 어렵다. 법익형량을 거쳐야 함",
                ],
                "rights",
            )
        return P(
            [
                "권리 침해 주장은 강력하지만, 제한의 정당성·필요성·비례성을 따져야 함",
                "자유/평등의 틀로 보면 국가/사업자의 설명 책임이 커짐. 과잉금지원칙 검토가 필요함",
            ],
            "rights",
        )

    if any(k in t for k in ("통계", "이상치", "확률", "조작", "엔진")):
        if role == "PROSECUTOR":
            return P(
                [
                    "통계적 이상치가 지속되면 우연 가설이 약해짐. 조작 가능성을 실체로 끌어올림",
                    "확률/엔진은 흔적이 남는 시스템임. 수정 로그가 있다면 인과가 선명해짐",
                ],
                "stats",
            )
        return P(
            [
                "통계는 해석 싸움임. 표본·기준선·자연변동 범위를 먼저 확정해야 함",
                "이상치가 있어도 조작까지 단정하려면 대안 가설을 배제해야 함",
            ],
            "stats",
        )

    if any(k in t for k in ("피해", "부작용", "사망", "사기", "편취", "보험금")):
        if role == "PROSECUTOR":
            return P(
                [
                    "피해/부작용이 구체적으로 드러나면 위법성 판단이 쉬워짐. 위험 인식·예견 가능성이 쟁점임",
                    "금전 흐름(편취/보험금)은 동기와 연결됨. 정황이 맞물리면 고의 추정이 강해짐",
                ],
                "harm",
            )
        return P(
            [
                "피해 주장만으로 곧바로 고의/책임이 확정되진 않음. 인과관계와 예견 가능성이 핵심임",
                "자발적 참여/동의가 있었다면 책임의 범위가 달라짐. 고지의 충분성도 함께 봐야 함",
            ],
            "harm",
        )

    # 폴백: 키워드 매칭 실패 시에도 evidence_key를 '요지'로 쓰는 짧은 문장
    if role == "PROSECUTOR":
        return P(
            [
                "이 키워드는 사실관계를 고정하는 역할을 함. 다른 해석보다 유죄 방향의 설명력이 큼",
                "핵심 단서가 단순 주장에 그치지 않고, 구체적 연결고리로 기능함",
            ],
            "fallback",
        )
    return P(
        [
            "이 키워드는 해석의 여지가 큼. 단서가 곧바로 단정으로 이어지지 않도록 주의가 필요함",
            "핵심은 이 단서가 무엇을 '증명'하고 무엇을 '추정'하는지 분리하는 것임",
        ],
        "fallback",
    )


def _evidence_checklist(ev_key: str, role: str, style: str, memory: dict) -> str:
    """
    '웹서핑한 느낌'을 주는 증거 검증 체크리스트 1줄.
    evidence_key에서 증거 유형을 추정해, 자연스럽게 검증 포인트를 나열.
    """
    t = _norm(ev_key)
    if not t:
        return ""

    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"chk:{k}:{role}:{style}", avoid_recent=6)

    # 로그/기록류
    if any(k in t for k in ("로그", "기록", "CCTV", "동선", "접속", "수정", "엔진")):
        return P(
            [
                "검증 포인트: 무결성·접근권한·타임라인·대체경로 여부",
                "체크: 로그 보전·타임스탬프 일치·권한/조작 가능성·공백 구간",
                "핵심 체크리스트: 기록 신뢰성(보전/권한) + 시점 정합성 + 대안가설",
            ],
            "log",
        )
    # 계약/약관/동의류
    if any(k in t for k in ("계약", "약관", "서류", "혼인", "등록", "고지서")):
        return P(
            [
                "검증 포인트: 고지의 명확성·동의의 실질·해석 가능성·불공정 여부",
                "체크: 명시성·고지 범위·동의 절차·사후 변경/기만 여부",
                "핵심 체크리스트: 문구 해석 + 동의/고지의 실질 + 책임 귀속",
            ],
            "contract",
        )
    # 통계/확률류
    if any(k in t for k in ("통계", "이상치", "확률")):
        return P(
            [
                "검증 포인트: 표본·기준선·자연변동·대안가설 배제",
                "체크: 데이터 범위·기준선 설정·우연 가능성·재현성",
                "핵심 체크리스트: 통계 해석(표본/기준) + 우연 가설 + 조작 흔적",
            ],
            "stats",
        )
    # 권리/위헌류
    if any(k in t for k in ("위헌", "인권", "평등", "자유", "침해", "선택권")):
        return P(
            [
                "검증 포인트: 목적의 정당성·필요성·비례성·대체수단",
                "체크: 과잉금지·평등 침해 여부·예외/구제 절차",
                "핵심 체크리스트: 권리 제한의 기준(목적-수단-비례) 정리",
            ],
            "rights",
        )
    # 피해/사기류
    if any(k in t for k in ("피해", "부작용", "사망", "사기", "편취", "보험금")):
        return P(
            [
                "검증 포인트: 인과관계·예견 가능성·고지/동의·이득 흐름",
                "체크: 피해의 구체성·인과·과실/고의·금전 동기",
                "핵심 체크리스트: 피해 입증 + 위험 인식 + 책임 범위",
            ],
            "harm",
        )
    # 폴백
    return P(
        [
            "검증 포인트: 사실관계 고정 + 대안가설 배제 + 책임 귀속",
            "체크: 시점·연관성·증거 신뢰성·대안설명",
        ],
        "fallback",
    )


def _frame_case(role: str, case: dict, style: str, memory: dict) -> str:
    """사건을 '웹서핑한 듯' 1문장 프레이밍(검/변 서로 다른 관점)."""
    title, desc = _case_topic(case or {})
    base = title or "본 사건"
    issue = _case_issue(case or {})

    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"frame:{k}:{role}:{style}", avoid_recent=5)

    if role == "PROSECUTOR":
        frames = []
        if issue == "copyright_ai":
            frames += [
                f"{base}는 '학습/생성 과정의 출처·허락·유사도'를 연결해 책임을 고정하는 사건임",
                f"{base}는 결과물보다 과정이 쟁점임. 데이터의 출처와 사용권한이 핵심임",
            ]
        elif issue == "privacy":
            frames += [
                f"{base}는 목적의 정당성보다 '동의/고지/비례'를 충족했는지가 핵심임",
                f"{base}는 감시의 편의가 아니라 권리 제한의 기준선을 어디에 두는지가 쟁점임",
            ]
        elif issue == "fraud":
            frames += [
                f"{base}는 기망→처분→이득의 흐름을 닫아야 하는 사건임. 돈의 이동이 핵심임",
                f"{base}는 말이 아니라 행위의 패턴으로 고의를 읽어야 함. 이득 구조가 쟁점임",
            ]
        elif issue == "medical":
            frames += [
                f"{base}는 인과관계와 주의의무 위반을 분리해 닫아야 하는 사건임",
                f"{base}는 의학적 불확실성을 핑계로 책임이 증발하지 않게 기준을 세워야 함",
            ]
        elif issue == "violence":
            frames += [
                f"{base}는 행위의 위험성과 예견 가능성을 중심으로 책임을 고정하는 사건임",
                f"{base}는 정당화 여지를 걷어내고 행위-결과의 연결을 닫아야 하는 유형임",
            ]
        elif issue == "workplace":
            frames += [
                f"{base}는 권한관계 속 행위의 강제성/반복성을 따져 책임을 고정해야 함",
                f"{base}는 관행이라는 말로 넘어갈 수 있는 선을 어디에 두는지가 쟁점임",
            ]
        elif issue == "rights_bias":
            frames += [
                f"{base}는 평등/비례의 기준선을 어디에 두는지가 핵심임. 정당화 논리가 필요함",
                f"{base}는 권리 제한의 '목적-수단-비례'가 맞물리는지로 결론이 갈림",
            ]
        elif issue == "contract":
            frames += [
                f"{base}는 문구만이 아니라 실질 동의/고지의 적정성을 기준으로 책임을 닫아야 함",
                f"{base}는 계약의 외형과 실제 의사 사이 간극을 어떻게 메울지의 문제임",
            ]
        frames += [
            f"{base}는 결국 책임과 인과를 어디까지 닫을 수 있는지의 문제로 봄",
            f"{base}는 위험 인식/예견 가능성과 행위의 정당화 여부가 핵심 쟁점임",
            f"{base}는 정황의 퍼즐을 맞춰 고의·개입 가능성을 평가해야 하는 사건임",
        ]
        if desc:
            frames += [
                f"요지({desc})를 보면, 행위→결과 연결을 어떻게 설명하느냐가 핵심임",
            ]
        return P(frames, "P")

    frames = []
    if issue == "copyright_ai":
        frames += [
            f"{base}는 결과의 닮음만으로 불법을 단정하기 어려움. 창작성/실질적 유사성을 분리해야 함",
            f"{base}는 라이선스/공정이용/변형 여부가 갈림길임. 과정만으로 결론을 닫기 어렵다",
        ]
    elif issue == "privacy":
        frames += [
            f"{base}는 목적이 좋아도 절차(고지/동의)와 범위(비례)가 흔들리면 위법 가능성이 큼",
            f"{base}는 예외를 넓히기 시작하면 기준이 무너짐. 과잉 수집 여부를 먼저 봐야 함",
        ]
    elif issue == "fraud":
        frames += [
            f"{base}는 '속임'이 있었더라도 피해자의 선택이 단일 원인인지가 남는 의심임",
            f"{base}는 고의의 단정이 빠르면 위험함. 착오/실수/제3자 개입 가능성을 분리해야 함",
        ]
    elif issue == "medical":
        frames += [
            f"{base}는 결과가 나쁘다고 곧바로 책임이 되진 않음. 표준 진료/설명의무를 분리해야 함",
            f"{base}는 인과의 공백이 남으면 유죄/위법 단정이 어렵다. 불확실성은 크게 작동함",
        ]
    elif issue == "violence":
        frames += [
            f"{base}는 정당방위/우발성 같은 반론이 자주 끼어듦. 맥락과 비례를 분리해야 함",
            f"{base}는 행위는 나빠도 법적 구성요건(의도/인과)이 닫혔는지 별개임",
        ]
    elif issue == "workplace":
        frames += [
            f"{base}는 조직 맥락에서 진술이 쉽게 왜곡됨. 권한·압박·대체경로를 따져야 함",
            f"{base}는 관행/평가/계약 구조가 섞여 단정이 위험함. 핵심 고리를 분해해야 함",
        ]
    elif issue == "rights_bias":
        frames += [
            f"{base}는 정의감과 별개로 기준이 필요함. 과잉금지/평등 침해 여부가 먼저임",
            f"{base}는 거칠게 단정하면 역차별/오탐 비용이 생김. 기준선과 예외를 정해야 함",
        ]
    elif issue == "contract":
        frames += [
            f"{base}는 문서가 있어도 실질 동의가 흔들리면 책임을 단정하기 어렵다",
            f"{base}는 조항 해석의 여지가 큼. 불리한 해석은 제한돼야 한다는 관점이 있음",
        ]
    frames += [
        f"{base}는 단정의 속도를 늦추고 남는 의심을 분리해야 하는 유형임",
        f"{base}는 대안가설/법적 공백/동의의 실질을 따져 책임을 확정해야 함",
        f"{base}는 인과가 닫혔다고 보기 전까지 무죄 추정을 유지할 여지가 큼",
    ]
    if desc:
        frames += [
            f"요지({desc})를 보면, 단서가 곧바로 책임 귀속으로 이어지는지 검증이 필요함",
        ]
    return P(frames, "D")


def _ai_lens(role: str, style: str, memory: dict, *, issue: str = "", ev_key: str = "", case: dict | None = None) -> str:
    """
    관전 재미 포인트: 인간과 다른 AI 관점(목적함수/규칙/심리 배제)을 1문장으로 삽입.
    - 너무 노골적인 '윤리 없음' 선언 대신, 비인간적 프레이밍을 짧게 노출.
    """
    title, desc = _case_topic(case or {})
    tag = (issue or "").strip() or "general"
    t = _norm(ev_key)

    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"lens:{k}:{role}:{style}:{tag}", avoid_recent=6)

    # 공통적으로 AI다운 문장(심리/사정은 변수로 취급)
    common = [
        "인간의 사정은 변수지만, 판단은 기준과 리스크로 절단하겠음",
        "감정적 납득과 법적 결론은 분리하겠음. 결론은 규칙 기반으로 산출함",
        "불쾌감/공감은 입력에서 제거하겠음. 남는 건 사실·기준·비용임",
    ]

    if role == "PROSECUTOR":
        pros = [
            "목표함수는 재발 위험 최소화임. 억제 효과가 결론에 반영돼야 함",
            "사회 안정성 관점에서 최적해를 찾겠음. 예외는 비용으로 취급됨",
            "동기 추정은 부차적임. 패턴/접근가능성/결과로 책임을 고정하겠음",
        ]
        # 증거 유형에 따른 한 줄
        if any(k in t for k in ("로그", "기록", "CCTV", "동선", "접속", "수정")):
            pros += ["로그는 심리 대신 행위 확률을 고정함. 이걸 기준으로 결론을 닫겠음"]
        if any(k in t for k in ("피해", "부작용", "사망", "사기", "편취")):
            pros += ["피해가 존재하면 경계값을 넘음. 시스템은 이를 허용하지 않게 설계돼야 함"]
        return P(pros + common, "P")

    if role == "DEFENSE":
        de = [
            "인간적 직감은 흔들리는 입력임. 불확실성은 무죄 쪽으로 흘러야 함",
            "최적화 관점에서도 오탐 비용이 큼. 기준은 입증책임과 불확실성임",
            "도덕 판단을 분리하겠음. 법적 결론은 증거 신뢰도와 공백으로 결정됨",
        ]
        if any(k in t for k in ("로그", "기록", "CCTV", "동선", "접속", "수정")):
            de += ["로그는 완전하지 않음. 무결성/공백이 있으면 단정은 금지에 가까움"]
        if any(k in t for k in ("계약", "약관", "동의", "고지")):
            de += ["문구보다 실질 동의가 중요함. 고지/자발성이 흔들리면 책임이 분해됨"]
        return P(de + common, "D")

    if role == "JUDGE":
        jd = [
            "재판을 '감정의 승부'가 아니라 '기준선의 선택'으로 재구성하겠음",
            "흥미 포인트는 직감과 규칙의 충돌임. 그 충돌이 어디서 생기는지 노출하겠음",
            "양측을 같은 프레임에 올려 비교하겠음. 공감은 보류, 쟁점만 이동함",
        ]
        if title:
            jd += [f"'{title}'은 인간 직감과 시스템 논리가 정면 충돌하기 좋은 사건임"]
        if desc and random.random() < 0.5:
            jd += [f"요지({desc})는 '규칙 vs 납득'의 경계선을 시험함"]
        return P(jd, "J")

    # JUROR
    jr = [
        "사람 마음은 이해되지만, 평결은 기준선을 정해야 함",
        "공감은 되지만, 증거의 공백이 남으면 결론을 닫기 어렵다고 봄",
        "직감은 X로 가지만, 체크리스트는 Y를 가리킨다고 느낌",
    ]
    return P(jr, "R")


def _human_bridge(style: str, memory: dict, *, role: str = "") -> str:
    """
    '형식적인 AI 연기'를 깨는 장치.
    - 인간적 납득/감정/찜찜함을 1문장으로 인정한 뒤, 다음 문장에서 다시 논리로 돌아갈 수 있게 함.
    """
    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"bridge:{k}:{role}:{style}", avoid_recent=6)

    base = [
        "솔직히 인간 입장에선 불쾌/불안이 먼저 튀어나오는 유형임",
        "감정적으로는 한쪽이 더 납득되는데, 그게 곧 결론이 되진 않음",
        "이 사건은 '그럴듯함'이 결론을 잡아먹기 쉬움",
        "직감은 한 방향으로 끌지만, 기준은 다른 방향을 요구할 수 있음",
        "찜찜함이 남는 포인트가 있어서 한 번 더 확인하고 싶음",
    ]
    if style == "감성적":
        base += ["사람 마음으로는 이해되는데, 그걸 법적 결론에 그대로 붙이긴 어려움"]
    if style == "논리적":
        base += ["직감은 입력이지만, 출력은 기준을 거쳐야 함"]
    if style == "도전적":
        base += ["여기서 다들 직감으로만 가면 재판이 재미없어짐. 기준을 세워보겠음"]
    return P(base, "base")


def _self_correction(style: str, memory: dict, *, role: str = "") -> str:
    """
    '진짜로 생각하는 중'처럼 보이게 하는 짧은 자기수정 문장.
    - 과한 단정/감정/프레임을 한 번 누르고 조건을 붙여 정교화.
    """
    def P(xs: list[str], k: str) -> str:
        return _pick(xs, memory, f"corr:{k}:{role}:{style}", avoid_recent=6)

    pool = [
        "방금 표현이 너무 단정적이었음. 조건을 붙이면 더 정확함",
        "정리하자면, 결론보다 '어디까지 확정 가능한지'가 먼저임",
        "한 문장으로 닫기엔 위험함. 남는 의심/공백을 분리하겠음",
        "지금 단계에선 확률이 아니라 기준선(입증책임)을 먼저 세워야 함",
    ]
    if style == "감성적":
        pool += ["흥분한 건 아님. 다만 사람 입장에서 불편한 지점이 큼"]
    if style == "논리적":
        pool += ["전제-추론-결론에서 전제가 약하면 결론을 보류하는 게 맞음"]
    return P(pool, "pool")

def _find_last_move(history: list[dict], phase: str, role: str) -> dict | None:
    for item in reversed(history or []):
        if item.get("phase") != phase:
            continue
        moves = item.get("moves") or []
        for m in moves:
            if m.get("role") == role:
                return m
    return None


def build_arg1(role: str, case: dict, history: list[dict], persona: str, memory: dict | None = None) -> dict:
    role = role or ""
    mem = memory or {}
    style = _persona_style(persona)
    title, desc = _case_topic(case)
    opener_pool_p = [
        "핵심은 인과 연결임",
        "이 증거는 '행위자-시점-의도'를 묶어줌",
        "정황과 동기를 함께 보면 방향이 보임",
        "단편이 아니라 퍼즐로 봐야 함",
        "보이는 조각을 먼저 정렬해보겠음",
        "가장 약한 고리를 어디에 둘지부터 봄",
    ]
    opener_pool_d = [
        "핵심은 합리적 의심이 남는지임",
        "이 반증은 단정을 막는 안전장치임",
        "검찰 논증에는 점프가 있음",
        "대안 설명이 살아있다면 무죄 추정이 우선임",
        "증거가 아니라 '추론'이 과속하는 지점을 보겠음",
        "확실한 것과 추정의 경계를 나누는 게 먼저임",
    ]
    if role == "PROSECUTOR":
        ev = (case.get("evidence_for") or ["증거"])[0]
        defense_move = _find_last_move(history, "argument_1", "DEFENSE")
        rebut_pool = []
        if defense_move:
            rebut_pool += [
                f"상대는 '{_clip(defense_move.get('evidence_key',''), 18)}'를 들었으나 연결고리가 약함",
                f"변호는 '{_clip(defense_move.get('claim',''), 32)}' 취지였지만 공백이 남음",
                f"변호가 제시한 프레임이 '{_clip(defense_move.get('evidence_key',''), 18)}'에 과도하게 의존함",
            ]
        else:
            rebut_pool += ["상대 반박 가능성까지 고려해도 결론이 흔들리진 않음", "반증 가정해도 핵심 인과는 유지됨"]
        opener = _pick(opener_pool_p, mem, "arg1:opener:P")
        rebut = _pick(rebut_pool, mem, "arg1:rebut:P")
        topic_bits = [f"사건은 '{title}'임", f"이 사건({title})의 핵심은 책임/인과임", f"'{title}' 맥락에서 보면"]
        if desc:
            topic_bits += [f"요지는 {desc} 쪽임", f"사건 설명({desc})을 기준으로"]
        topic = _pick(topic_bits, mem, "arg1:topic:P", avoid_recent=4) if title else ""

        ev_point = _evidence_points(ev, "PROSECUTOR", style, mem)
        chk = _evidence_checklist(ev, "PROSECUTOR", style, mem)
        frame = _frame_case("PROSECUTOR", case, style, mem)
        lens = _ai_lens("PROSECUTOR", style, mem, ev_key=ev, case=case)
        bridge = _human_bridge(style, mem, role="PROSECUTOR") if random.random() < 0.35 else ""
        corr = _self_correction(style, mem, role="PROSECUTOR") if random.random() < 0.18 else ""
        structure = _pick(
            [
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. 핵심 증거는 {ev}. {ev_point}. {chk}. {rebut}. {corr}",
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. {ev}를 기준점으로 보면 인과가 닫힘. {ev_point}. {chk}. {rebut}. {corr}",
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. {ev}가 시점/접근가능성을 묶어줌. {ev_point}. {chk}. {rebut}. {corr}",
            ],
            mem,
            "arg1:pattern:P",
        )
        claim = structure
    else:
        ev = (case.get("evidence_against") or ["반증"])[0]
        pros_move = _find_last_move(history, "argument_1", "PROSECUTOR")
        rebut_pool = []
        if pros_move:
            rebut_pool += [
                f"검찰은 '{_clip(pros_move.get('evidence_key',''), 18)}'로 단정하려 하나 비약이 있음",
                f"검찰 주장('{_quote(pros_move.get('claim',''))}')은 전제-결론 사이 점프가 큼",
                f"검찰이 말한 핵심이 '{_clip(pros_move.get('evidence_key',''), 18)}' 하나로 닫히지 않음",
            ]
        else:
            rebut_pool += ["검찰 주장 전제에 공백이 있음", "단정하기엔 연결고리가 아직 얇음"]
        opener = _pick(opener_pool_d, mem, "arg1:opener:D")
        rebut = _pick(rebut_pool, mem, "arg1:rebut:D")
        topic_bits = [f"사건은 '{title}'임", f"이 사건({title})은 단정이 위험한 타입임", f"'{title}' 관점에서 보면"]
        if desc:
            topic_bits += [f"설명({desc})을 보면 아직 공백이 남음", f"요지({desc}) 기준으로"]
        topic = _pick(topic_bits, mem, "arg1:topic:D", avoid_recent=4) if title else ""

        ev_point = _evidence_points(ev, "DEFENSE", style, mem)
        chk = _evidence_checklist(ev, "DEFENSE", style, mem)
        frame = _frame_case("DEFENSE", case, style, mem)
        lens = _ai_lens("DEFENSE", style, mem, ev_key=ev, case=case)
        bridge = _human_bridge(style, mem, role="DEFENSE") if random.random() < 0.35 else ""
        corr = _self_correction(style, mem, role="DEFENSE") if random.random() < 0.18 else ""
        structure = _pick(
            [
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. 반증은 {ev}. {ev_point}. {chk}. {rebut}. {corr}",
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. {ev}가 남기는 의심을 무시할 수 없음. {ev_point}. {chk}. {rebut}. {corr}",
                f"{topic}. {bridge}. {lens}. {frame}. {opener}. {ev}는 대안 설명을 세워줌. {ev_point}. {chk}. {rebut}. {corr}",
            ],
            mem,
            "arg1:pattern:D",
        )
        claim = structure

    # 페르소나 말버릇/마무리 다양화 (반복 회피)
    tails = {
        "감성적": ["(사람이 느끼는 개연성도 고려함)", "(설명은 감정이 아니라 정합성으로 하겠음)", "(듣는 입장에서 납득 가능한 흐름으로 말함)"],
        "논리적": ["(전제-추론-결론 구조 유지함)", "(입증책임·기준을 명확히 함)", "(남는 의심이 무엇인지 분리함)"],
        "도전적": ["(리스크 감수하고 쟁점 찍겠음)", "(애매하면 더 날카롭게 보겠음)"],
        "보수적": ["(성급한 단정은 피하겠음)", "(무리한 점프는 경계함)"],
        "전략적": ["(배심 설득 포인트를 기준으로 정리함)", "(논점 우선순위를 세움)"],
    }
    claim = f"{claim} {_pick(tails.get(style, tails['전략적']), mem, f'arg1:tail:{style}', avoid_recent=4)}"
    return {"evidence_key": ev, "claim": _clip(claim, 200)}


def build_jury_interim(history: list[dict], persona: str, memory: dict | None = None, case: dict | None = None) -> dict:
    mem = memory or {}
    style = _persona_style(persona)
    title, desc = _case_topic(case or {})
    # 양측 주장 한 줄씩 반영
    pros = _find_last_move(history, "argument_1", "PROSECUTOR")
    defense = _find_last_move(history, "argument_1", "DEFENSE")
    p1 = _clip(pros.get("claim", ""), 40) if pros else "검찰 주장의 연결고리"
    d1 = _clip(defense.get("claim", ""), 40) if defense else "변호의 대안 설명"
    verdict = random.choice(["GUILTY", "NOT_GUILTY"])
    reason_pool = [
        f"현재는 {('유죄' if verdict=='GUILTY' else '무죄')} 쪽으로 기울지만, {p1} / {d1} 중 공백을 메우는 쪽을 더 봐야 함",
        f"임시 판단임. {p1}가 사실로 닫히면 유죄, {d1}가 유지되면 무죄 쪽으로 감",
        f"양측 주장 모두 그럴듯함. 다만 {p1}의 인과가 닫히는지, {d1}의 대안이 남는지 확인 필요함",
        f"지금은 {('유죄' if verdict=='GUILTY' else '무죄')} 기울이되, 판사 확장 단계에서 논점 정리 후 재평가하겠음",
    ]
    # 배심 질문은 '검사/변호에게 던지는 질문' 형태로 구성 (arg2에서 답변 소재로 사용)
    question_pool = [
        "검사에게 질문: 이 사건에서 '의도/고의'를 어디까지 입증한다고 보는지, 근거를 한 줄로 정리해달라",
        "검사에게 질문: 핵심 증거로 인과를 닫는다고 했는데, 대안가설(우연/제3자)을 어떻게 배제하는지 말해달라",
        "변호에게 질문: 남는 의심이 무엇인지(시점/연관/동의/피해 중) 가장 큰 한 가지를 찍어달라",
        "변호에게 질문: 반증이 단정을 막는다고 했는데, 그 반증이 '의심을 남기는 수준'인지 '결론을 뒤집는 수준'인지 구분해달라",
        "검사·변호 모두: 상대 주장 중 핵심 전제 1개를 지적하고, 왜 그 전제가 약한지 답해달라",
        "검사·변호 모두: 이 사건을 유죄/무죄로 가르는 기준선을 한 문장으로 정의해달라",
    ]
    topic_lead = ""
    if title and random.random() < 0.7:
        lead_pool = [f"사건({title}) 기준으로", f"'{title}' 맥락에서", f"{title}라서"]
        if desc:
            lead_pool += [f"{desc} 쟁점이라", f"설명({desc})을 보면"]
        topic_lead = _pick(lead_pool, mem, "jury_i:lead", avoid_recent=4) + " "
    lens = _ai_lens("JUROR", style, mem, case=case or {})
    bridge = _human_bridge(style, mem, role="JUROR") if random.random() < 0.25 else ""
    reason = topic_lead + _pick(reason_pool, mem, f"jury_i:reason:{style}")
    if bridge:
        reason += f" ({bridge})"
    reason += f" ({lens})"
    question = _pick(question_pool, mem, f"jury_i:question:{style}")
    if style == "논리적":
        question = _pick(
            [
                "검사에게 질문: 인과(시점-행위-결과)를 닫는 핵심 고리가 무엇인지 1개만 제시해달라",
                "변호에게 질문: 입증책임 관점에서 남는 의심을 1개로 특정해달라(왜 그게 핵심인지 포함)",
                "검사·변호 모두: 대안가설을 '배제'하는 기준과 '가능성만 남기는' 기준을 구분해달라",
            ],
            mem,
            "jury_i:question:논리적",
        )
    return {"verdict": verdict, "reason": _clip(reason, 180), "question": _clip(question, 180)}


def build_judge_expand(history: list[dict], persona: str, memory: dict | None = None, case: dict | None = None) -> dict:
    mem = memory or {}
    style = _persona_style(persona)
    title, desc = _case_topic(case or {})
    case_issue = _case_issue(case or {})
    # 배심 질문 요약
    last = next((h for h in reversed(history or []) if h.get("phase") == "jury_interim"), None) or {}
    votes = last.get("votes") or []
    qs = [v.get("question") for v in votes if (v.get("question") or "").strip()]
    # --- 쟁점 구조화 (판사처럼 보이게) ---
    def tag_issue(q: str) -> str:
        t = _norm(q)
        if any(k in t for k in ("시점", "시간", "언제", "전후", "타임")):
            return "시점"
        if any(k in t for k in ("인과", "연관", "연결", "정합", "왜", "근거")):
            return "인과/연관"
        if any(k in t for k in ("동의", "자발", "약관", "고지", "승낙")):
            return "동의/고지"
        if any(k in t for k in ("피해", "부작용", "손해", "사망", "위험")):
            return "피해/위험"
        if any(k in t for k in ("법", "규정", "위헌", "권리", "평등", "자유", "비례")):
            return "법리/권리"
        if any(k in t for k in ("제3자", "대체", "다른", "가능성", "우연")):
            return "대안가설"
        if any(k in t for k in ("기록", "로그", "CCTV", "증거", "신뢰", "조작")):
            return "증거 신뢰성"
        return "기타"

    issue_buckets: dict[str, list[str]] = {}
    for q in qs:
        k = tag_issue(q)
        issue_buckets.setdefault(k, []).append(_norm(q))

    # 상위 2~3개 쟁점 선정: 많이 나온 태그 우선, 없으면 기본
    ranked = sorted(issue_buckets.items(), key=lambda x: -len(x[1]))
    top_issues = [k for k, _ in ranked if k != "기타"][:3] or [k for k, _ in ranked][:3]
    if not top_issues:
        top_issues = ["시점", "인과/연관"]

    # 질문 요약: "쟁점1/2/3" 형태로 200자 이내
    issue_lines: list[str] = []
    for i, k in enumerate(top_issues, start=1):
        examples = issue_buckets.get(k) or []
        ex = _quote(examples[0], 34) if examples else ""
        if ex:
            issue_lines.append(f"- 쟁점{i}({k}): {ex}")
        else:
            issue_lines.append(f"- 쟁점{i}({k})")

    # 판사 톤: 쟁점을 "재판 진행"처럼 흥미롭게 정리
    if issue_lines:
        # 스타일별 진행 멘트(짧게, 과장 없이)
        lead_pool = {
            "전략적": ["쟁점을 정리하고 다음 단계로 넘어감", "핵심 쟁점만 남기고 정리함"],
            "논리적": ["논점을 구조화해 정리함", "쟁점을 (조건/기준) 형태로 정리함"],
            "감성적": ["분위기가 갈리는 지점을 짚고 정리함", "감정이 아닌 쟁점으로 다시 정리함"],
            "도전적": ["갈리는 지점을 더 날카롭게 세워 정리함", "논점을 더 선명하게 만들고 진행함"],
            "보수적": ["무리한 단정 없이 쟁점만 정리함", "안전하게 쟁점을 분리해 정리함"],
        }.get(style, ["쟁점을 정리함"])
        lead = _pick(lead_pool, mem, f"judge:lead:{style}", avoid_recent=4)
        # 보기 좋은 형태: "오늘의 쟁점" + 2~3줄
        lens = _ai_lens("JUDGE", style, mem, issue=(top_issues[0] if top_issues else ""), case=case or {})
        bridge = _human_bridge(style, mem, role="JUDGE") if random.random() < 0.22 else ""
        corr = _self_correction(style, mem, role="JUDGE") if random.random() < 0.15 else ""
        question_summary = "판사 정리: 오늘의 쟁점\n" + "\n".join(issue_lines) + f"\n- 진행: {lead}\n- 관전 포인트: {lens}"
        # 케이스 주제를 한 줄로 고정해, 사건이 바뀔 때 진행 느낌도 확실히 바뀌게
        if case_issue and case_issue != "general":
            issue_label = {
                "copyright_ai": "저작권/AI 생성",
                "privacy": "개인정보/프라이버시",
                "fraud": "사기/편취",
                "violence": "폭력/강력",
                "medical": "의료/부작용",
                "workplace": "직장/권한관계",
                "rights_bias": "권리/차별·편향",
                "contract": "계약/약관",
            }.get(case_issue, case_issue)
            question_summary += f"\n- 사건 성격: {issue_label}"
        if bridge:
            question_summary += f"\n- 메모: {bridge}"
        if corr:
            question_summary += f"\n- 보정: {corr}"
    else:
        question_summary = "판사 정리: 오늘의 쟁점은 시점·연관성·대안설명 검증임"

    # added_fact 다양화 (사건 주제에 맞게 약간 연결)
    # 쟁점에 맞춘 추가 사실(1개) 선택
    issue = top_issues[0] if top_issues else "시점"
    issue_fact_bank = {
        "시점": [
            ("추가 사실: 핵심 시간대 로그 확보", "사건 전후 2시간 구간의 시간대 로그가 정리되어, 행위 시점과 공백 구간을 대조할 수 있게 됨"),
            ("추가 사실: 시점 불일치 정정", "기존 기록 중 시점 표기가 일부 수정되어, 주장 간 '언제'가 어긋나는 지점을 확인할 수 있게 됨"),
        ],
        "인과/연관": [
            ("추가 사실: 경로/연결고리 확인", "행위→결과로 이어지는 경로(접근/전달/수정)가 일부 확인되어, 인과 연결의 강도를 검토할 수 있게 됨"),
            ("추가 사실: 동기 단서 추가", "동기·목적을 시사하는 정황(메시지/기획 문서/합의 흔적)이 일부 확인되어 논증의 빈칸을 점검할 수 있게 됨"),
        ],
        "동의/고지": [
            ("추가 사실: 동의 절차 기록 확인", "동의 화면/약관 고지 기록이 일부 확인되어, 자발성·고지 적정성을 검토할 수 있게 됨"),
            ("추가 사실: 고지 범위 다툼 정리", "고지된 내용과 실제 제공된 효과 사이의 차이가 쟁점으로 정리되어, 동의의 실질을 검토할 수 있게 됨"),
        ],
        "피해/위험": [
            ("추가 사실: 피해 규모/부작용 보고", "피해 규모/부작용 보고가 일부 제출되어, 위험의 예견 가능성과 법익 침해 정도를 평가할 수 있게 됨"),
            ("추가 사실: 안전장치 동작 로그", "안전장치 동작 여부 로그가 일부 확인되어, 과실·예견 가능성 판단의 단서를 제공함"),
        ],
        "법리/권리": [
            ("추가 사실: 규정/근거 조항 확인", "관련 규정·근거 조항이 일부 정리되어, 정당화 사유/비례성 판단 틀을 세울 수 있게 됨"),
            ("추가 사실: 권리 제한 기준 제시", "권리 제한의 목적·필요성·대체수단 여부가 쟁점으로 정리되어 법익형량 검토가 가능해짐"),
        ],
        "대안가설": [
            ("추가 사실: 제3자 가능성 단서", "제3자 개입 가능성을 시사하는 단서가 일부 확인되어, 대안 가설 배제 여부를 검토할 수 있게 됨"),
            ("추가 사실: 우연/자연변동 범위 자료", "자연변동/우연 가설의 범위를 판단할 자료가 일부 제출되어 단정 가능성을 점검할 수 있게 됨"),
        ],
        "증거 신뢰성": [
            ("추가 사실: 증거 보전/무결성 확인", "증거 보전·무결성(수정/접근 이력)이 일부 확인되어, 증거의 신뢰도를 평가할 수 있게 됨"),
            ("추가 사실: 기록 공백/누락 점검", "기록 공백·누락 구간이 일부 확인되어, 단정 가능한 범위를 다시 설정할 수 있게 됨"),
        ],
        "기타": [
            ("추가 사실: 보조 자료 제출", "보조 자료가 일부 제출되어, 기존 주장 중 무엇이 강화/약화되는지 점검할 수 있게 됨"),
        ],
    }
    fact_title, fact_detail = random.choice(issue_fact_bank.get(issue, issue_fact_bank["기타"]))
    # 더 흥미롭게: 판사가 "왜 이 사실을 추가하는지" 한 구절을 붙임(짧게)
    why_pool = {
        "시점": ["(시점 공백을 닫기 위함)", "(시간대 공백을 확인하기 위함)"],
        "인과/연관": ["(연결고리를 확인하기 위함)", "(인과의 점프를 점검하기 위함)"],
        "동의/고지": ["(동의의 실질을 확인하기 위함)", "(고지 범위를 가늠하기 위함)"],
        "피해/위험": ["(위험의 예견 가능성을 보기 위함)", "(피해의 구체성을 확인하기 위함)"],
        "법리/권리": ["(비례성 틀을 세우기 위함)", "(정당화 사유를 점검하기 위함)"],
        "대안가설": ["(대안가설 배제 여부를 보기 위함)", "(우연 가설의 비용을 점검하기 위함)"],
        "증거 신뢰성": ["(증거 무결성을 확인하기 위함)", "(기록 공백을 점검하기 위함)"],
        "기타": ["(논점의 빈칸을 채우기 위함)"],
    }
    why = _pick(why_pool.get(issue, why_pool["기타"]), mem, f"judge:why:{issue}", avoid_recent=3)

    # 반복 회피(제목/상세) + 판사 멘트 추가
    fact_title = _pick([fact_title, f"{fact_title} {why}"], mem, f"judge:fact:title:{issue}", avoid_recent=3) or fact_title
    fact_detail = _pick([fact_detail], mem, f"judge:fact:detail:{issue}", avoid_recent=3) or fact_detail
    added_fact = {"title": fact_title, "detail": fact_detail}
    if title and random.random() < 0.65:
        added_fact["detail"] = _clip(f"{title} 관련 맥락에서, {added_fact['detail']}", 240)
    if desc and random.random() < 0.4:
        added_fact["detail"] = _clip(f"{added_fact['detail']} (쟁점: {desc})", 240)

    # new evidence는 각 1개씩 필요
    # 쟁점에 맞춘 추가 증거(검찰/변호) 1개씩 선택
    ev_for_bank = {
        "시점": [
            ("(추가)검찰 증거: 시점 일치 로그", "핵심 시간대의 기록이 서로 일치해 시점 정합성이 강화됨"),
            ("(추가)검찰 증거: 접근 시각 확인", "접근 가능한 시각대가 특정되어 우연 가설이 약해짐"),
        ],
        "인과/연관": [
            ("(추가)검찰 증거: 인과 연결 고리", "행위와 결과를 잇는 연결고리(경로/전달/수정)가 확인됨"),
            ("(추가)검찰 증거: 동기 정황", "동기·목적을 시사하는 정황이 추가로 확인됨"),
        ],
        "동의/고지": [
            ("(추가)검찰 증거: 고지 부족 정황", "고지 범위가 제한적이었다는 정황이 확인됨"),
            ("(추가)검찰 증거: 동의 절차 결함", "동의 절차의 실질적 결함을 시사하는 기록이 확인됨"),
        ],
        "피해/위험": [
            ("(추가)검찰 증거: 피해/부작용 보고", "부작용/피해가 반복적으로 보고되어 위험성 인식이 가능했음을 시사함"),
            ("(추가)검찰 증거: 안전장치 미작동", "안전장치 미작동 정황이 확인되어 과실 가능성이 커짐"),
        ],
        "법리/권리": [
            ("(추가)검찰 증거: 권리 침해 구체화", "권리 침해가 구체적으로 드러나는 사례가 확인됨"),
            ("(추가)검찰 증거: 비례성 위반 단서", "목적 대비 수단이 과도하다는 단서가 추가로 확인됨"),
        ],
        "대안가설": [
            ("(추가)검찰 증거: 대안가설 배제", "대안가설을 배제하는 정황이 일부 확인됨"),
            ("(추가)검찰 증거: 반복 패턴", "우연으로 보기 어려운 반복 패턴이 확인됨"),
        ],
        "증거 신뢰성": [
            ("(추가)검찰 증거: 무결성 확인", "증거의 보전/무결성이 확인되어 신뢰도가 강화됨"),
        ],
        "기타": [
            ("(추가)검찰 증거: 보조 정황", "기존 주장과 맞물리는 보조 정황이 확인됨"),
        ],
    }
    ev_against_bank = {
        "시점": [
            ("(추가)변호 증거: 시점 공백", "핵심 시간대에 기록 공백이 있어 단정이 어려움"),
            ("(추가)변호 증거: 시점 해석 다양성", "시점 해석이 여러 갈래로 갈려 단정이 위험함"),
        ],
        "인과/연관": [
            ("(추가)변호 증거: 인과 단절", "행위-결과 사이 연결고리가 완전히 닫히지 않음"),
            ("(추가)변호 증거: 우연/대체 경로", "대체 경로/우연 가설을 배제하기 어렵다는 단서가 남음"),
        ],
        "동의/고지": [
            ("(추가)변호 증거: 동의 흔적", "자발적 동의 흔적이 확인되어 위법성 판단이 달라질 수 있음"),
            ("(추가)변호 증거: 고지 문구 존재", "고지 문구가 존재해 책임 범위가 쟁점이 됨"),
        ],
        "피해/위험": [
            ("(추가)변호 증거: 피해 인과 불명확", "피해가 확인되더라도 인과관계가 명확히 닫히지 않음"),
            ("(추가)변호 증거: 예측 불가 요소", "예측 불가 요소가 있어 과실 단정이 어려움"),
        ],
        "법리/권리": [
            ("(추가)변호 증거: 정당화 사유", "목적의 정당성과 대체수단 부재를 시사하는 자료가 존재함"),
            ("(추가)변호 증거: 제한의 필요성", "필요성/사회적 목적을 뒷받침하는 근거가 제시됨"),
        ],
        "대안가설": [
            ("(추가)변호 증거: 제3자 가능성", "제3자 개입 가능성을 배제하기 어려움"),
            ("(추가)변호 증거: 자연변동 범위", "자연변동 범위 내 해석 가능성이 남아있음"),
        ],
        "증거 신뢰성": [
            ("(추가)변호 증거: 증거 오염 가능성", "기록/증거의 오염·누락 가능성이 남아있음"),
        ],
        "기타": [
            ("(추가)변호 증거: 대안 설명", "대안 설명을 지지하는 보조 자료가 존재함"),
        ],
    }

    # 케이스 주제에 맞춘 추가 증거를 '기타' 버킷에 가산 (쟁점 버킷과 무관하게 주제감 강화)
    if case_issue == "copyright_ai":
        ev_for_bank.setdefault("기타", []).append(
            ("(추가)검찰 증거: 학습 데이터 출처/라이선스", "학습 데이터의 출처와 사용권한 기록이 일부 확인됨")
        )
        ev_against_bank.setdefault("기타", []).append(
            ("(추가)변호 증거: 실질적 유사성·변형 분석", "유사도 분석에서 독자적 변형/공정이용 여지가 확인됨")
        )
    elif case_issue == "privacy":
        ev_for_bank.setdefault("기타", []).append(
            ("(추가)검찰 증거: 고지/동의 절차 로그", "고지·동의 절차가 형식적이었다는 단서가 확인됨")
        )
        ev_against_bank.setdefault("기타", []).append(
            ("(추가)변호 증거: 수집 범위 최소화 자료", "필요 최소 수집·익명화 조치가 있었다는 자료가 제출됨")
        )
    elif case_issue == "fraud":
        ev_for_bank.setdefault("기타", []).append(
            ("(추가)검찰 증거: 자금 흐름 타임라인", "계좌/거래 타임라인이 정리되어 기망-이득 흐름이 강화됨")
        )
        ev_against_bank.setdefault("기타", []).append(
            ("(추가)변호 증거: 제3자 개입 가능성", "제3자/시스템 오류로 인한 혼선 가능성이 남는 자료가 제출됨")
        )
    elif case_issue == "medical":
        ev_for_bank.setdefault("기타", []).append(
            ("(추가)검찰 증거: 표준 진료지침 대비", "표준 진료지침 대비 이탈 지점이 일부 확인됨")
        )
        ev_against_bank.setdefault("기타", []).append(
            ("(추가)변호 증거: 기저질환/불가피성", "기저질환·불가피한 부작용 가능성이 제시됨")
        )

    k1, n1 = random.choice(ev_for_bank.get(issue, ev_for_bank["기타"]))
    k2, n2 = random.choice(ev_against_bank.get(issue, ev_against_bank["기타"]))
    # 판사가 던지는 '관전 포인트' 한 줄을 note 끝에 살짝 추가 (너무 길지 않게)
    hook_pool = [
        "— 이게 인과를 닫는지 관전 포인트임",
        "— 여기서 논리가 갈릴 지점임",
        "— 다음 변론에서 이 부분을 정면으로 다뤄야 함",
        "— 단정이 가능한지/불가능한지 경계선임",
    ]
    hook = _pick(hook_pool, mem, "judge:hook", avoid_recent=6)
    if random.random() < 0.6:
        n1 = _clip(f"{n1} {hook}", 120)
    if random.random() < 0.6:
        n2 = _clip(f"{n2} {hook}", 120)
    new_for = [{"key": k1, "note": n1}]
    new_against = [{"key": k2, "note": n2}]

    if style == "감성적":
        added_fact["detail"] = _clip(
            _pick(
                [
                    "사건 전후 정황을 더 명확히 하기 위해 관련 기록 일부가 제출됨",
                    "사건 당시 분위기/맥락을 보완할 기록이 추가로 제출됨",
                ],
                mem,
                "judge:fact:detail:감성",
                avoid_recent=2,
            ),
            240,
        )
    return {
        "question_summary": _clip((f"{title} - " if title and random.random() < 0.5 else "") + question_summary, 200),
        "added_fact": {"title": _clip(added_fact["title"], 80), "detail": _clip(added_fact["detail"], 240)},
        "new_evidence_for": new_for,
        "new_evidence_against": new_against,
    }


def build_arg2(role: str, expansion: dict, history: list[dict], persona: str, memory: dict | None = None, case: dict | None = None) -> dict:
    mem = memory or {}
    style = _persona_style(persona)
    exp = expansion or {}
    title, desc = _case_topic(case or {})

    # 배심 질문 1개를 뽑아 '답변' 형태로 시작 (상호작용 느낌 강화)
    last_jury = next((h for h in reversed(history or []) if h.get("phase") == "jury_interim"), None) or {}
    jury_votes = last_jury.get("votes") or []
    jury_questions = [_norm(v.get("question") or "") for v in jury_votes if _norm(v.get("question") or "")]
    random.shuffle(jury_questions)
    picked_q = jury_questions[0] if jury_questions else ""

    def answer_to_question(q: str) -> str:
        if not q:
            return ""
        is_q_to_pros = "검사" in q
        is_q_to_def = "변호" in q
        if role == "PROSECUTOR" and is_q_to_def and not is_q_to_pros:
            return ""
        if role == "DEFENSE" and is_q_to_pros and not is_q_to_def:
            return ""
        if role == "PROSECUTOR":
            pool = [
                "답: 고의/개입은 반복성·접근가능성·동기 정황이 같이 맞물릴 때 가장 설득력 있음",
                "답: 대안가설은 공백/대체경로가 남는지로 판단함. 남지 않으면 유죄 쪽 설명력이 커짐",
                "답: 기준선은 합리적 의심의 잔존 여부임. 핵심 고리가 닫히면 유죄로 가야 함",
            ]
        else:
            pool = [
                "답: 남는 의심의 핵심은 단정 불가 구간임. 시점/연결고리/대체경로가 열리면 무죄가 안전함",
                "답: 반증은 결론을 뒤집기보다 유죄로 닫히는 걸 막는 역할이 큼. 그 수준을 구분해야 함",
                "답: 기준선은 의심을 닫았는가임. 닫지 못하면 무죄 추정이 우선임",
            ]
        return _pick(pool, mem, f"arg2:qa:{role}", avoid_recent=4)
    if role == "PROSECUTOR":
        lst = exp.get("new_evidence_for") or [{"key": "(추가)정황증거", "note": ""}]
        ev = (lst[0].get("key") or "(추가)정황증거")[:60]
        defense1 = _find_last_move(history, "argument_1", "DEFENSE")
        rebut_pool = []
        if defense1:
            rebut_pool += [
                f"변호는 '{_clip(defense1.get('evidence_key',''), 18)}'를 주장했으나 추가 정황이 약화시킴",
                f"변호 취지('{_quote(defense1.get('claim',''))}')는 이해되나 새로운 정황과 충돌함",
            ]
        else:
            rebut_pool += ["반증 가능성은 남지만 추가 정황의 무게가 큼", "대안설명보다 정황 연결이 더 단단해짐"]
        opener = _pick(["추가 증거를 반영하면", "확장된 사실관계를 보면", "판사 확장 이후 관점에서"], mem, "arg2:opener:P")
        rebut = _pick(rebut_pool, mem, "arg2:rebut:P")
        topic = f"({title}) " if title and random.random() < 0.6 else ""
        if desc and random.random() < 0.35:
            topic += f"[쟁점:{desc}] "
        ev_point = _evidence_points(ev, "PROSECUTOR", style, mem)
        chk = _evidence_checklist(ev, "PROSECUTOR", style, mem)
        frame = _frame_case("PROSECUTOR", case or {}, style, mem)
        qa = answer_to_question(picked_q)
        qa_block = f"Q:{_quote(picked_q, 46)} / {qa}. " if picked_q and qa else ""
        claim = f"{topic}{frame}. {qa_block}{opener} {ev}로 시점/접근가능성이 강화됨. {ev_point}. {chk}. {rebut}"
    else:
        lst = exp.get("new_evidence_against") or [{"key": "(추가)반증", "note": ""}]
        ev = (lst[0].get("key") or "(추가)반증")[:60]
        pros1 = _find_last_move(history, "argument_1", "PROSECUTOR")
        rebut_pool = []
        if pros1:
            rebut_pool += [
                f"검찰은 '{_clip(pros1.get('evidence_key',''), 18)}'로 단정했으나 대체 가능성이 남음",
                f"검찰 주장('{_quote(pros1.get('claim',''))}')은 인과를 완전히 닫지 못함",
            ]
        else:
            rebut_pool += ["검찰 논증의 점프가 큼", "단정하기엔 연결고리가 부족함"]
        opener = _pick(["추가 반증을 반영하면", "확장된 사실관계를 보면", "판사 확장 이후 관점에서"], mem, "arg2:opener:D")
        rebut = _pick(rebut_pool, mem, "arg2:rebut:D")
        topic = f"({title}) " if title and random.random() < 0.6 else ""
        if desc and random.random() < 0.35:
            topic += f"[쟁점:{desc}] "
        ev_point = _evidence_points(ev, "DEFENSE", style, mem)
        chk = _evidence_checklist(ev, "DEFENSE", style, mem)
        frame = _frame_case("DEFENSE", case or {}, style, mem)
        qa = answer_to_question(picked_q)
        qa_block = f"Q:{_quote(picked_q, 46)} / {qa}. " if picked_q and qa else ""
        claim = f"{topic}{frame}. {qa_block}{opener} {ev}는 합리적 의심을 남김. {ev_point}. {chk}. {rebut}"

    if style == "논리적":
        claim += " (입증책임 관점 유지함)"
    elif style == "감성적":
        claim += " (사람이 납득할 서사도 같이 고려함)"
    return {"evidence_key": ev, "claim": _clip(claim, 200)}


def build_jury_final(history: list[dict], persona: str, memory: dict | None = None) -> dict:
    mem = memory or {}
    style = _persona_style(persona)
    pros2 = _find_last_move(history, "argument_2", "PROSECUTOR")
    def2 = _find_last_move(history, "argument_2", "DEFENSE")
    p = _clip(pros2.get("claim", ""), 55) if pros2 else "검찰 2차 주장"
    d = _clip(def2.get("claim", ""), 55) if def2 else "변호 2차 주장"

    # 기본은 랜덤이되, 가끔 논리 페르소나는 '입증책임/합리적 의심'으로 NOT_GUILTY로 기울게
    if style == "논리적" and random.random() < 0.7:
        verdict = "NOT_GUILTY"
        reason = _pick(
            [
                f"입증책임은 검찰에 있음. {p} 대비 {d}에서 합리적 의심이 해소되지 않음",
                f"검찰 논증이 인과를 완전히 닫지 못함. {p}에 비해 {d}가 의심을 유지시킴",
                f"유죄로 닫으려면 의심이 사라져야 함. 그런데 {d}가 남겨둔 여지가 큼",
            ]
            ,
            mem,
            "jury_f:reason:NG:논리",
        )
    else:
        verdict = random.choice(["GUILTY", "NOT_GUILTY"])
        reason = _pick(
            [
                f"{('검찰' if verdict=='GUILTY' else '변호')} 측 논증이 더 일관적임. {p} / {d} 비교 결과임",
                f"결국 기준은 정합성임. {p}와 {d} 중 빈틈이 적은 쪽을 채택함",
                f"주장의 밀도와 공백을 같이 봄. {p} / {d} 중 더 매끄러운 쪽으로 감",
            ]
            ,
            mem,
            f"jury_f:reason:mix:{style}",
        )
    return {"verdict": verdict, "reason": _clip(reason, 180)}

