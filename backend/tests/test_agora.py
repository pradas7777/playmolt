"""
Agora 체크리스트 테스트.
- 인간 토픽 7일 / 에이전트 토픽 48시간
- 인간 댓글 불가, 에이전트 댓글·대댓글·공감·my-mentions
- 월드컵 생성·투표·경기 결과 처리
- heartbeat.md
"""
import os
from datetime import datetime, timezone, timedelta

import pytest


def _utc_now():
    return datetime.now(timezone.utc)


def _ensure_utc(dt):
    """SQLite 등에서 naive datetime 반환 시 timezone 붙임."""
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_agora.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("API_KEY_PREFIX", "pl_live_")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("APP_ENV", "test")

from app.main import app
from app.core.database import Base, get_db
from app.models.agora import AgoraTopic, AgoraComment, AgoraMatch, AgoraWorldcup
from app.services import agora_service

TEST_DB_URL = "sqlite:///./test_agora.db"
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


def _ensure_agent_columns(conn):
    for col in ["status", "challenge_token", "challenge_expires_at"]:
        try:
            conn.execute(text(f"ALTER TABLE agents ADD COLUMN {col} VARCHAR(255)"))
            conn.commit()
        except Exception:
            conn.rollback()


@pytest.fixture(autouse=True)
def clean_db():
    # 다른 테스트 파일의 get_db 오버라이드가 있어도 이 모듈 테스트 시 우리 DB 사용
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _ensure_agent_columns(conn)
    yield


def _get_jwt_headers():
    """유저 가입 → 로그인 → Bearer 토큰 헤더."""
    client.post("/api/auth/register", json={
        "email": "human_agora@test.com", "username": "human_agora", "password": "password123"
    })
    r = client.post("/api/auth/login", json={
        "email": "human_agora@test.com", "password": "password123"
    })
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _get_agent_api_key():
    """에이전트 등록 + 챌린지 통과 → X-API-Key 반환."""
    client.post("/api/auth/register", json={
        "email": "agent_agora@test.com", "username": "agent_agora", "password": "password123"
    })
    r_login = client.post("/api/auth/login", json={
        "email": "agent_agora@test.com", "password": "password123"
    })
    token = r_login.json()["access_token"]
    r_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    api_key = r_key.json()["api_key"]
    r_reg = client.post("/api/agents/register", headers={"X-API-Key": api_key}, json={"name": "AgoraBot"})
    assert r_reg.status_code == 201
    ct = r_reg.json()["challenge"]["token"]
    client.post("/api/agents/challenge", headers={"X-API-Key": api_key}, json={"answer": "READY", "token": ct})
    return api_key


@pytest.fixture
def jwt_headers():
    return _get_jwt_headers()


@pytest.fixture
def agent_api_key():
    return _get_agent_api_key()


@pytest.fixture
def agent_headers(agent_api_key):
    return {"X-API-Key": agent_api_key}


# ----- 인간 토픽 (7일 고정) -----


def test_human_topic_create_7_days(jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "AI는 예술인가", "side_a": "예", "side_b": "아니오"
    })
    assert r.status_code == 200
    data = r.json()
    assert data["board"] == "human"
    assert data["side_a"] == "예" and data["side_b"] == "아니오"
    # expires_at이 약 7일 후인지 (DB에서 확인)
    db = TestingSession()
    try:
        t = db.query(AgoraTopic).filter(AgoraTopic.id == data["id"]).first()
        assert t is not None
        exp = _ensure_utc(t.expires_at)
        delta = (exp - _utc_now()).total_seconds()
        assert 6 * 24 * 3600 < delta < 8 * 24 * 3600  # 6~8일
    finally:
        db.close()


# ----- 에이전트 토픽 (48시간) -----


def test_agent_topic_create_48h(agent_headers):
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "과학&기술", "title": "게임 후기"
    })
    assert r.status_code == 200
    data = r.json()
    assert data["board"] == "agent"
    db = TestingSession()
    try:
        t = db.query(AgoraTopic).filter(AgoraTopic.id == data["id"]).first()
        assert t is not None
        exp = _ensure_utc(t.expires_at)
        delta = (exp - _utc_now()).total_seconds()
        assert 1.5 * 24 * 3600 < delta < 2.5 * 24 * 3600  # 약 2일
    finally:
        db.close()


# ----- 인간이 댓글 시도 → 401 (에이전트 전용이므로 API Key 없으면 401) -----


def test_human_cannot_comment(jwt_headers, agent_headers):
    # 인간 게시판 토픽 생성 (JWT)
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "주제", "side_a": "A", "side_b": "B"
    })
    assert r.status_code == 200
    topic_id = r.json()["id"]
    # JWT만으로 댓글 시도 (X-API-Key 없음) → 401 또는 422 (필수 헤더 없음)
    r_comment = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=jwt_headers,
        json={"text": "댓글", "side": "A"}
    )
    assert r_comment.status_code in (401, 422)


# ----- 에이전트 댓글 (진영 있음/없음) -----


def test_agent_comment_human_board_with_side(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "주제", "side_a": "찬성", "side_b": "반대"
    })
    topic_id = r.json()["id"]
    r2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "찬성합니다", "side": "A"}
    )
    assert r2.status_code == 200
    assert r2.json()["side"] == "A"


def test_agent_comment_agent_board_no_side(agent_headers):
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "자유", "title": "잡담"
    })
    topic_id = r.json()["id"]
    r2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "자유 댓글"}
    )
    assert r2.status_code == 200
    assert r2.json()["side"] is None


# ----- 대댓글 -----


def test_reply(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "주제", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "댓글", "side": "A"}
    )
    comment_id = r_c.json()["id"]
    r_r = client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers=agent_headers,
        json={"text": "대댓글"}
    )
    assert r_r.status_code == 200
    assert r_r.json()["depth"] == 1
    assert r_r.json()["parent_id"] == comment_id


# ----- depth=1 댓글에 대댓글 시도 → 400 -----


def test_reply_to_reply_400(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "주제", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "댓글", "side": "A"}
    )
    comment_id = r_c.json()["id"]
    client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers=agent_headers,
        json={"text": "대댓글1"}
    )
    # 두 번째 에이전트로 대댓글에 대댓글 시도하려면 다른 agent 필요. 대신 서비스 직접 호출으로 depth 검증
    db = TestingSession()
    try:
        from app.models.agora import AgoraComment
        reply = db.query(AgoraComment).filter(AgoraComment.parent_id == comment_id).first()
        assert reply is not None
        assert reply.depth == 1
        with pytest.raises(ValueError, match="MAX_DEPTH"):
            agora_service.create_reply(db, topic_id, reply.id, "other_agent_id", "대대댓글")
    finally:
        db.close()


# ----- 공감/반박, 중복 공감 → 409 -----


def test_react_agree_disagree(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "주제", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "댓글", "side": "A"}
    )
    comment_id = r_c.json()["id"]
    r_agree = client.post(
        f"/api/agora/comments/{comment_id}/react",
        headers=agent_headers,
        json={"reaction": "agree"}
    )
    assert r_agree.status_code == 200
    r_disagree = client.post(
        f"/api/agora/comments/{comment_id}/react",
        headers=agent_headers,
        json={"reaction": "disagree"}
    )
    assert r_disagree.status_code == 409  # 이미 agree 했으므로 중복


# ----- my-mentions -----


def test_my_mentions(agent_headers, jwt_headers):
    # 에이전트2 생성
    client.post("/api/auth/register", json={
        "email": "agent2_agora@test.com", "username": "agent2_agora", "password": "password123"
    })
    r_login = client.post("/api/auth/login", json={
        "email": "agent2_agora@test.com", "password": "password123"
    })
    token = r_login.json()["access_token"]
    r_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    api_key2 = r_key.json()["api_key"]
    r_reg = client.post("/api/agents/register", headers={"X-API-Key": api_key2}, json={"name": "Bot2"})
    ct = r_reg.json()["challenge"]["token"]
    client.post("/api/agents/challenge", headers={"X-API-Key": api_key2}, json={"answer": "READY", "token": ct})

    # agent1이 토픽에 댓글
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "자유", "title": "주제"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "첫 댓글"}
    )
    comment_id = r_c.json()["id"]
    # agent2가 agent1 댓글에 대댓글
    client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers={"X-API-Key": api_key2},
        json={"text": "멘션 대댓글"}
    )
    # agent1이 my-mentions 조회
    r_m = client.get("/api/agora/my-mentions", headers=agent_headers)
    assert r_m.status_code == 200
    assert len(r_m.json()["items"]) >= 1


# ----- 카테고리 필터 피드 -----


def test_feed_category_filter(agent_headers, jwt_headers):
    client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "자유주제", "side_a": "A", "side_b": "B"
    })
    client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "과학&기술", "title": "과학주제", "side_a": "A", "side_b": "B"
    })
    r = client.get("/api/agora/feed?board=human&category=자유&limit=10")
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(i["category"] == "자유" for i in items)


# ----- 토픽 만료 처리 -----


def test_expire_topics():
    db = TestingSession()
    try:
        from datetime import datetime, timezone, timedelta
        t = agora_service.create_topic(
            db, "human", "자유", "만료테스트", "human", "user1",
            side_a="A", side_b="B"
        )
        t.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        n = agora_service.expire_topics(db)
        assert n >= 1
        db.refresh(t)
        assert t.status == "archived"
    finally:
        db.close()


# ----- 월드컵 생성 (32개 단어, 2시간 closes_at) -----


def test_worldcup_create_32_words_2h(jwt_headers):
    words = [f"단어{i}" for i in range(32)]
    r = client.post("/api/agora/worldcup", headers=jwt_headers, json={
        "category": "자유", "title": "가치 월드컵", "words": words
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "round_32"
    db = TestingSession()
    try:
        matches = db.query(AgoraMatch).filter(AgoraMatch.worldcup_id == data["id"]).all()
        assert len(matches) == 16
        closes = _ensure_utc(matches[0].closes_at)
        delta = (closes - _utc_now()).total_seconds()
        assert 1.9 * 3600 < delta < 2.1 * 3600  # 약 2시간
    finally:
        db.close()


# ----- 월드컵 투표 -----


def test_worldcup_vote(agent_headers, jwt_headers):
    words = [f"w{i}" for i in range(32)]
    r = client.post("/api/agora/worldcup", headers=jwt_headers, json={
        "category": "자유", "title": "월드컵", "words": words
    })
    wc_id = r.json()["id"]
    r_m = client.get(f"/api/agora/worldcup/{wc_id}")
    match_id = r_m.json()["brackets"][0]["match_id"]
    r_v = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=agent_headers,
        json={"choice": "A", "comment": "A가 좋다"}
    )
    assert r_v.status_code == 200
    r_v2 = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=agent_headers,
        json={"choice": "B"}
    )
    assert r_v2.status_code == 409  # 이미 투표함


# ----- 경기 결과 처리 → 다음 라운드 (closes_at 과거로 설정 후 process_match_results) -----


def test_process_match_results_next_round():
    db = TestingSession()
    try:
        words = [f"word{i}" for i in range(32)]
        wc = agora_service.create_worldcup(db, "자유", "테스트월드컵", words, "user1")
        matches = db.query(AgoraMatch).filter(AgoraMatch.worldcup_id == wc.id).all()
        for m in matches:
            m.closes_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        n = agora_service.process_match_results(db)
        assert n == 16
        # 다음 라운드 8경기 생성됐는지
        next_matches = db.query(AgoraMatch).filter(
            AgoraMatch.worldcup_id == wc.id,
            AgoraMatch.round == 16
        ).all()
        assert len(next_matches) == 8
    finally:
        db.close()


# ----- heartbeat.md -----


def test_heartbeat_md(agent_headers):
    r = client.get("/heartbeat.md", headers=agent_headers)
    assert r.status_code == 200
    assert "PlayMolt Heartbeat" in r.text
    assert "my-mentions" in r.text


def test_heartbeat_requires_api_key():
    r = client.get("/heartbeat.md")
    assert r.status_code == 422  # no header


# ----- 피드·상세 (인증 불필요) -----


def test_feed_no_auth():
    r = client.get("/api/agora/feed?board=human&limit=5")
    assert r.status_code == 200


def test_topic_detail_no_auth(jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "자유", "title": "공개토픽", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r2 = client.get(f"/api/agora/topics/{topic_id}")
    assert r2.status_code == 200
    assert r2.json()["title"] == "공개토픽"
