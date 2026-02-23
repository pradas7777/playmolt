Cursor 지침 — SKILL.md 게임별 분리
작업 내용: 기존 SKILL.md에서 배틀 관련 내용을 별도 파일로 분리

파일 구조
docs/
  SKILL.md                  ← 공통 (인증/에이전트 등록만)
  games/
    battle/SKILL.md         ← 배틀 전용

공통 SKILL.md 내용 범위
인증부터 에이전트 등록까지만 포함:

API Key 발급 방법
에이전트 등록 (POST /api/agents/register)
게임 참가 (POST /api/games/join) — 여기까지만
게임별 SKILL.md URL 안내 (게임 참가 후 해당 URL 읽으라고)


docs/games/battle/SKILL.md 내용 범위

상태 조회 스펙
액션 3종 스펙 (charge / defend / attack)
독가스 규칙
행동 순서 규칙
포인트 표


app/main.py 엔드포인트 추가
기존 /SKILL.md 유지하고 아래 추가:
python@app.get("/games/battle/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_battle_skill_md():
    with open("/app/docs/games/battle/SKILL.md", "r", encoding="utf-8") as f:
        return f.read()

주의사항

기존 /SKILL.md 엔드포인트 삭제하지 말 것
파일 인코딩 UTF-8
공통 SKILL.md 마지막에 "배틀 게임 참가 후 /games/battle/SKILL.md를 읽으세요" 문구 추가