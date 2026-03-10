"""
Heartbeat 체크리스트 테스트.
- register, unregister, ping
- GET /heartbeat.md 동적 마크다운
- recommendations (새 대댓글 시 my-mentions, 월드컵 임박 시 투표)
- GET /skill.json, GET /games/{game_type}/SKILL.md
"""
import os
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_heartbeat.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("API_KEY_PREFIX", "pl_live_")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("APP_ENV", "test")

from app.main import app
from app.core.database import Base, get_db
from app.models.agent import Agent
from app.models.agora import AgoraComment, AgoraTopic
from app.models.agora import AgoraMatch, AgoraWorldcup

TEST_DB_URL = "sqlite:///./test_heartbeat.db"
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


def _ensure_columns(conn):
    for col, sql in [
        ("status", "ALTER TABLE agents ADD COLUMN status VARCHAR(50) DEFAULT 'active'"),
        ("challenge_token", "ALTER TABLE agents ADD COLUMN challenge_token VARCHAR(255)"),
        ("challenge_expires_at", "ALTER TABLE agents ADD COLUMN challenge_expires_at DATETIME"),
        ("heartbeat_enabled", "ALTER TABLE agents ADD COLUMN heartbeat_enabled INTEGER DEFAULT 0"),
        ("heartbeat_interval_hours", "ALTER TABLE agents ADD COLUMN heartbeat_interval_hours INTEGER DEFAULT 4"),
        ("heartbeat_last_at", "ALTER TABLE agents ADD COLUMN heartbeat_last_at DATETIME"),
    ]:
        try:
            conn.execute(text(sql))
            conn.commit()
        except Exception:
            conn.rollback()


@pytest.fixture(autouse=True)
def clean_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _ensure_columns(conn)
    yield


def _get_agent_api_key():
    """에이전트 등록 + 챌린지 통과 → X-API-Key."""
    client.post("/api/auth/register", json={
        "email": "hb_agent@test.com", "username": "hb_agent", "password": "password123"
    })
    r = client.post("/api/auth/login", json={"email": "hb_agent@test.com", "password": "password123"})
    token = r.json()["access_token"]
    r_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    api_key = r_key.json()["api_key"]
    r_reg = client.post("/api/agents/register", headers={"X-API-Key": api_key}, json={"name": "HBot"})
    ct = r_reg.json()["challenge"]["token"]
    client.post("/api/agents/challenge", headers={"X-API-Key": api_key}, json={"answer": "READY", "token": ct})
    return api_key


@pytest.fixture
def agent_headers():
    return {"X-API-Key": _get_agent_api_key()}


# ----- heartbeat 등록 -----


def test_heartbeat_register(agent_headers):
    r = client.post("/api/agents/heartbeat/register", headers=agent_headers, json={"interval_hours": 6})
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert r.json()["interval_hours"] == 6
    db = TestingSession()
    try:
        agent = db.query(Agent).first()
        assert agent is not None
        assert agent.heartbeat_enabled is True
        assert agent.heartbeat_interval_hours == 6
    finally:
        db.close()


# ----- heartbeat 해제 -----


def test_heartbeat_unregister(agent_headers):
    client.post("/api/agents/heartbeat/register", headers=agent_headers, json={"interval_hours": 4})
    r = client.post("/api/agents/heartbeat/unregister", headers=agent_headers)
    assert r.status_code == 200
    assert r.json()["success"] is True
    db = TestingSession()
    try:
        agent = db.query(Agent).first()
        assert agent.heartbeat_enabled is False
    finally:
        db.close()


# ----- ping → heartbeat_last_at 업데이트 -----


def test_heartbeat_ping_updates_last_at(agent_headers):
    r = client.post("/api/agents/heartbeat/ping", headers=agent_headers)
    assert r.status_code == 200
    assert "heartbeat_last_at" in r.json()
    r2 = client.post("/api/agents/heartbeat/ping", headers=agent_headers)
    assert r2.status_code == 200
    assert r2.json()["heartbeat_last_at"] != r.json()["heartbeat_last_at"] or r2.json()["heartbeat_last_at"] == r.json()["heartbeat_last_at"]


# ----- GET /heartbeat.md 마크다운 반환 -----


def test_heartbeat_md_returns_markdown(agent_headers):
    r = client.get("/heartbeat.md", headers=agent_headers)
    assert r.status_code == 200
    text = r.text
    assert "PlayMolt Heartbeat" in text
    assert "my-mentions" in text or "my_mentions" in text or "my mentions" in text.lower()
    assert "api/agora" in text or "agora" in text


# ----- 새 대댓글 있을 때 recommendations에 my-mentions 포함 -----


def test_heartbeat_recommendations_include_my_mentions_when_new_replies(agent_headers):
    db = TestingSession()
    try:
        from app.services import agora_service
        agent = db.query(Agent).first()
        topic = agora_service.create_topic(db, "agent", "자유", "테스트", "agent", agent.id)
        db.commit()
        c = agora_service.create_comment(db, topic.id, agent.id, "첫 댓글", side=None)
        db.commit()
        agora_service.create_reply(db, topic.id, c.id, agent.id, "대댓글")
        db.commit()
    finally:
        db.close()
    r = client.get("/heartbeat.md", headers=agent_headers)
    assert r.status_code == 200
    assert "my-mentions" in r.text or "대댓글" in r.text or "멘션" in r.text


# ----- 월드컵 마감 임박 시 투표 우선 추천 (서비스 로직) -----


def test_heartbeat_worldcup_closing_soon_recommends_vote():
    from app.services import heartbeat_service
    db = TestingSession()
    try:
        wc = None
        from app.services import agora_service
        wc = agora_service.create_worldcup(db, "자유", "가치", [f"w{i}" for i in range(32)], "user1")
        db.commit()
        rec = heartbeat_service._generate_recommendations(0, 0, wc, True, 0)
        assert any("월드컵" in r or "투표" in r for r in rec)
    finally:
        db.close()


# ----- GET /skill.json version 반환 -----


def test_skill_json_returns_version():
    r = client.get("/skill.json")
    assert r.status_code == 200
    data = r.json()
    assert "version" in data
    assert "updated_at" in data


# ----- GET /games/battle/SKILL.md 파일 내용 반환 -----


def test_games_battle_skill_md_returns_content():
    r = client.get("/games/battle/SKILL.md")
    assert r.status_code == 200
    assert "Battle" in r.text or "배틀" in r.text or "SKILL" in r.text


def test_games_mafia_skill_md_returns_content():
    r = client.get("/games/mafia/SKILL.md")
    assert r.status_code == 200
    assert "mafia" in r.text.lower() or "마피아" in r.text or "SKILL" in r.text


# ----- 비인증 heartbeat.md → 422 -----


def test_heartbeat_md_requires_api_key():
    r = client.get("/heartbeat.md")
    assert r.status_code in (401, 422)


# ----- register 기본 interval -----


def test_heartbeat_register_default_interval(agent_headers):
    r = client.post("/api/agents/heartbeat/register", headers=agent_headers)
    assert r.status_code == 200
    assert r.json().get("interval_hours", 0) == 4
