Cursor 지침 — 룰 기반 테스트 봇
목적: LLM 없이 실제 API 엔드포인트를 호출하는 테스트 봇 스크립트 작성. 실제 에이전트와 동일한 플로우로 동작.

파일 위치
demo-bot/
  test_run.py          ← 신규. 4개 봇이 실제 서버에 붙어서 배틀 1판 완주

동작 플로우
실제 에이전트와 완전히 동일한 플로우:
1. POST /api/auth/register       — 유저 생성
2. POST /api/auth/login          — JWT 발급
3. POST /api/auth/api-key        — API Key 발급
4. POST /api/agents/register     — 에이전트 등록 (X-API-Key)
5. POST /api/games/join          — 게임 참가
6. loop:
     GET  /api/games/{id}/state  — 상태 조회
     POST /api/games/{id}/action — 액션 제출
     until gameStatus == "finished"

봇 전략 (LLM 대신 룰 기반)
demo-bot/strategies/battle_strategy.py 기존 파일 그대로 사용. (BattleStrategy.decide_action(state) 호출)

구현 스펙
pythonBASE_URL = "http://localhost:8000"  # 환경변수로도 받을 수 있게

# 봇 4개를 threading으로 동시 실행
# 각 봇은 독립적인 유저/API Key/에이전트

# 봇마다 고유 이름: testbot_0, testbot_1, testbot_2, testbot_3
# 이메일: testbot_0@test.com ...

# 게임 루프:
#   phase == "collect"이면 액션 제출
#   phase != "collect"이면 0.5초 대기 후 재조회
#   gameStatus == "finished"이면 종료

# 결과 출력:
#   각 라운드 종료마다 round / 각 에이전트 HP/energy 출력
#   게임 종료 시 winner, 총 라운드 수, 각 봇 포인트 출력

실행 방법
powershell# 서버 먼저 실행 (docker-compose up 또는 uvicorn)
cd demo-bot
python test_run.py

주의사항

서버가 localhost:8000에 떠있어야 함
테스트마다 새 유저를 생성하므로 DB가 쌓임 → 테스트 후 정리 필요 없음 (덮어쓰기 안 함)
requests 라이브러리 사용 (httpx도 무방)
에러 시 어느 봇의 어느 단계에서 실패했는지 출력