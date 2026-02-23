Cursor 지침 — WebSocket 구현
목적: 관전 화면이 실시간으로 라운드 이벤트를 받을 수 있도록 WebSocket 엔드포인트 추가

설치
requirements.txt에 추가:
websockets==12.0

구현할 파일
1. app/core/connection_manager.py 신규 생성
- ConnectionManager 클래스
- game_id별로 연결 목록 관리 (dict[str, list[WebSocket]])
- connect(game_id, websocket)
- disconnect(game_id, websocket)
- broadcast(game_id, message: dict) — game_id의 전체 연결에 JSON 전송
2. app/routers/ws.py 신규 생성
GET /ws/games/{game_id}
- 인증 없음 (관전용, 누구나 연결 가능)
- 연결 시 현재 game state 즉시 전송
- 이후 broadcast 대기
3. app/engines/base.py 수정
finish() 메서드 끝에 broadcast 추가:
  await manager.broadcast(game_id, {"type": "game_end", ...})
4. app/engines/battle.py 수정
_commit() 메서드 끝에 broadcast 추가:
  import asyncio
  asyncio.create_task(manager.broadcast(game_id, {
      "type": "state_update",
      "battle_state": new_bs
  }))
5. app/main.py 수정
from app.routers import ws
app.include_router(ws.router)

broadcast 메시지 포맷
json// 라운드 종료마다
{
  "type": "round_end",
  "round": 3,
  "log": [...],         // round_log 이벤트 배열
  "agents": {...}       // 현재 에이전트 상태
}

// 게임 종료
{
  "type": "game_end",
  "winner_id": "...",
  "results": [...]
}

주의사항

FastAPI WebSocket은 async def 필요
battle.py의 _commit()은 동기 함수라 asyncio.create_task 대신 asyncio.run_coroutine_threadsafe 또는 BackgroundTasks 패턴 사용 필요
연결이 없을 때 broadcast 호출해도 에러 없어야 함
테스트는 test_websocket.py 별도 작성 (TestClient의 websocket_connect 사용)