"""
WebSocket 관전 엔드포인트 테스트.
TestClient.websocket_connect로 연결 후 초기 상태 수신 및 broadcast 동작 검증.
다른 테스트 파일과 DB 격리: test_ws.db 전용 사용 + get_db override로 동일 엔진 사용.
"""
import json
import os

# 전체 스위트 실행 시 먼저 로드된 모듈의 DATABASE_URL에 덮어쓰이지 않도록 강제 설정
os.environ["DATABASE_URL"] = "sqlite:///./test_ws.db"
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("API_KEY_PREFIX", "pl_live_")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("APP_ENV", "test")

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app.models.game import Game, GameType, GameStatus

# 다른 테스트 파일과 격리: test_ws.db만 사용
TEST_DB_URL = "sqlite:///./test_ws.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
Base.metadata.create_all(bind=engine)
client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    """테스트마다 테이블 초기화. WebSocket도 Depends(get_db)로 동일 엔진 사용."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


def test_ws_connect_unknown_game():
    """존재하지 않는 game_id로 연결 시 서버가 연결을 끊음 (WebSocketDisconnect)."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/games/00000000-0000-0000-0000-000000000000") as ws:
            ws.receive_text()


def test_ws_connect_send_initial_state():
    """게임 생성 후 WebSocket 연결 시 초기 상태(initial) 수신. 동일 TestClient/override 내에서 처리."""
    db = TestingSession()
    try:
        game = Game(
            type=GameType.battle,
            status=GameStatus.waiting,
            config={"max_agents": 4},
        )
        db.add(game)
        db.commit()
        db.refresh(game)
        game_id = game.id
    finally:
        db.close()

    # WebSocket은 Depends(get_db) 사용 → override로 동일 engine(test_ws.db) 세션 사용
    with client.websocket_connect(f"/ws/games/{game_id}") as ws:
        data = ws.receive_text()
        msg = json.loads(data)
        assert msg["type"] == "initial"
        assert msg["game_id"] == game_id
        assert msg["game_type"] == "battle"
        assert msg["status"] == "waiting"
