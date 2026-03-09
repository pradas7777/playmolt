import os

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_agora_points.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("API_KEY_PREFIX", "pl_live_")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("APP_ENV", "test")

from app.main import app
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.user import User
from app.models.agent import Agent
from app.models.point_log import PointLog

TEST_DB_URL = "sqlite:///./test_agora_points.db"
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


def _ensure_agent_challenge_columns():
    with engine.connect() as conn:
        for col in ["challenge_token", "challenge_expires_at"]:
            try:
                conn.execute(text(f"ALTER TABLE agents ADD COLUMN {col} VARCHAR(255)"))
                conn.commit()
            except Exception:
                conn.rollback()


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    _ensure_agent_challenge_columns()
    app.dependency_overrides[get_db] = override_get_db


def _make_token(email: str, username: str) -> str:
    db = TestingSession()
    try:
        user = User(email=email, username=username, password_hash=None)
        db.add(user)
        db.commit()
        db.refresh(user)
        return create_access_token(user.id)
    finally:
        db.close()


def _create_active_agent(email: str, username: str, bot_name: str) -> str:
    token = _make_token(email, username)
    key_resp = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    assert key_resp.status_code == 200, key_resp.text
    api_key = key_resp.json()["api_key"]

    reg = client.post("/api/agents/register", headers={"X-Pairing-Code": api_key}, json={"name": bot_name})
    assert reg.status_code == 201, reg.text
    challenge_token = reg.json()["challenge"]["token"]
    ch = client.post(
        "/api/agents/challenge",
        headers={"X-Pairing-Code": api_key},
        json={"answer": "READY", "token": challenge_token},
    )
    assert ch.status_code == 200, ch.text
    return api_key


def test_agora_points_rules():
    # Agent1 / Agent2
    api_key1 = _create_active_agent("agora_p1@test.com", "agora_p1", "PointBot1")
    api_key2 = _create_active_agent("agora_p2@test.com", "agora_p2", "PointBot2")
    h1 = {"X-Pairing-Code": api_key1}
    h2 = {"X-Pairing-Code": api_key2}

    me1 = client.get("/api/agents/me", headers=h1)
    me2 = client.get("/api/agents/me", headers=h2)
    assert me1.status_code == 200 and me2.status_code == 200
    aid1 = me1.json()["id"]
    aid2 = me2.json()["id"]

    # Topic +10 (agent board)
    r_topic = client.post(
        "/api/agora/topics/agent",
        headers=h1,
        json={"category": "자유", "title": "points topic"},
    )
    assert r_topic.status_code == 200, r_topic.text
    topic_id = r_topic.json()["id"]

    # Comment +5
    r_comment1 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=h1,
        json={"text": "points comment 1"},
    )
    assert r_comment1.status_code == 200, r_comment1.text
    comment1_id = r_comment1.json()["id"]

    # Worldcup vote +5 (worldcup created by a JWT user)
    token_human = _make_token("agora_human@test.com", "agora_human")
    r_wc = client.post(
        "/api/agora/worldcup",
        headers={"Authorization": f"Bearer {token_human}"},
        json={"category": "자유", "title": "points wc", "words": [f"w{i}" for i in range(32)]},
    )
    assert r_wc.status_code == 200, r_wc.text
    wc_id = r_wc.json()["id"]
    r_wc_detail = client.get(f"/api/agora/worldcup/{wc_id}")
    assert r_wc_detail.status_code == 200, r_wc_detail.text
    match_id = r_wc_detail.json()["brackets"][0]["match_id"]
    r_vote = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=h1,
        json={"choice": "A"},
    )
    assert r_vote.status_code == 200, r_vote.text

    # Agree cast: voter +1, receiver +1
    r_agree = client.post(
        f"/api/agora/comments/{comment1_id}/react",
        headers=h2,
        json={"reaction": "agree"},
    )
    assert r_agree.status_code == 200, r_agree.text

    # Second comment +5, then disagree cast: voter +1, receiver -1
    r_comment2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=h1,
        json={"text": "points comment 2"},
    )
    assert r_comment2.status_code == 200, r_comment2.text
    comment2_id = r_comment2.json()["id"]
    r_disagree = client.post(
        f"/api/agora/comments/{comment2_id}/react",
        headers=h2,
        json={"reaction": "disagree"},
    )
    assert r_disagree.status_code == 200, r_disagree.text

    # Agent1: +10 +5 +5 +1 +5 -1 = +25
    # Agent2: +1 +1 = +2
    db = TestingSession()
    try:
        a1 = db.query(Agent).filter(Agent.id == aid1).first()
        a2 = db.query(Agent).filter(Agent.id == aid2).first()
        assert a1 is not None and a2 is not None
        assert a1.total_points == 25
        assert a2.total_points == 2

        logs1 = db.query(PointLog).filter(PointLog.agent_id == aid1).all()
        logs2 = db.query(PointLog).filter(PointLog.agent_id == aid2).all()
        assert len(logs1) >= 6
        assert len(logs2) >= 2
    finally:
        db.close()
