"""
LLM 챌린지 검증 테스트
등록 → challenge 응답 확인, 올바른 token+READY → active, 잘못된/만료 token 실패, 미검증 시 join 403
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = "sqlite:///./test_challenge.db"

from app.main import app
from app.core.database import Base, get_db
from app.models.agent import Agent, AgentStatus

TEST_DB_URL = "sqlite:///./test_challenge.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def _restore_get_db_override():
    """다른 테스트 파일이 get_db를 덮어쓴 경우를 대비해 매 테스트 전에 복원."""
    app.dependency_overrides[get_db] = override_get_db
    yield


def _ensure_challenge_columns(conn):
    """테스트 DB에 챌린지 컬럼이 있도록 보장 (create_all만으로는 미생성될 수 있음)."""
    for col in ["challenge_token", "challenge_expires_at"]:
        try:
            conn.execute(text(f"ALTER TABLE agents ADD COLUMN {col} VARCHAR(255)"))
            conn.commit()
        except Exception:
            conn.rollback()
            pass


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _ensure_challenge_columns(conn)
    yield


def _register_pending_agent():
    """에이전트 등록만 하고 챌린지 안 함. (api_key, challenge_token) 반환. 구글 전용: DB에 유저 생성."""
    from app.models.user import User
    from app.core.security import create_access_token
    uid = str(uuid.uuid4())[:8]
    email, username = f"ch_{uid}@test.com", f"chuser_{uid}"
    db = TestingSession()
    try:
        user = User(email=email, username=username, password_hash=None)
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id)
    finally:
        db.close()
    r_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r_key.status_code == 200, r_key.text
    api_key = r_key.json()["api_key"]
    r = client.post("/api/agents/register", headers={"X-API-Key": api_key}, json={"name": "ChBot"})
    assert r.status_code == 201
    data = r.json()
    assert data["status"] == "pending"
    assert "challenge" in data
    return api_key, data["challenge"]["token"]


def test_register_returns_challenge():
    """등록 시 challenge 정보 응답 확인"""
    api_key, challenge_token = _register_pending_agent()
    r = client.get("/api/agents/me", headers={"X-API-Key": api_key})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert len(challenge_token) > 0


def test_challenge_success_activates_agent():
    """올바른 token + READY → status active"""
    api_key, token = _register_pending_agent()
    r = client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "READY", "token": token}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    r2 = client.get("/api/agents/me", headers={"X-API-Key": api_key})
    assert r2.json()["status"] == "active"


def test_challenge_wrong_token_fails():
    """잘못된 token → 실패"""
    api_key, _ = _register_pending_agent()
    r = client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "READY", "token": "wrong-token-12345"}
    )
    assert r.status_code == 400
    r2 = client.get("/api/agents/me", headers={"X-API-Key": api_key})
    assert r2.json()["status"] == "pending"


def test_challenge_wrong_answer_fails():
    """answer != READY → 실패"""
    api_key, token = _register_pending_agent()
    r = client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "NOT_READY", "token": token}
    )
    assert r.status_code == 400
    r2 = client.get("/api/agents/me", headers={"X-API-Key": api_key})
    assert r2.json()["status"] == "pending"


def test_challenge_expired_fails():
    """만료된 token → 400, 재시도 시 새 토큰 안내"""
    api_key, token = _register_pending_agent()
    past_iso = (datetime.now(timezone.utc) - timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    # 같은 엔진(테스트용)으로 만료 시각을 과거로 UPDATE
    with engine.connect() as conn:
        conn.execute(
            text("UPDATE agents SET challenge_expires_at = :t WHERE challenge_token = :tok"),
            {"t": past_iso, "tok": token}
        )
        conn.commit()
    r = client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "READY", "token": token}
    )
    assert r.status_code == 400, r.json()
    assert "만료" in r.json().get("detail", "")


def test_join_without_challenge_returns_403():
    """챌린지 안 한 에이전트가 게임 참가 시도 → 403 AGENT_NOT_VERIFIED"""
    api_key, _ = _register_pending_agent()
    r = client.post("/api/games/join",
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        json={"game_type": "battle"}
    )
    assert r.status_code == 403
    assert r.json().get("detail") == "AGENT_NOT_VERIFIED"
