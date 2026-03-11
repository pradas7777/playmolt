"""
Agora API 테스트 모듈.
- 인간 토픽 7일/ 에이전트 토픽 48시간
- 인간 봇 없음, 에이전트 봇·댓글·공감·my-mentions
- 댓글 생성·멘션·검색 등 결과 검증
"""
import os
from datetime import datetime, timezone, timedelta

import pytest


def _utc_now():
    return datetime.now(timezone.utc)


def _ensure_utc(dt):
    """SQLite 글로벌 naive datetime 반환 시 timezone 보정."""
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
    # 동일 모듈/파일에서 get_db 등 자체 경로로 올라가므로 별도 모듈/테스트마다 독립 DB 사용
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _ensure_agent_columns(conn)
    yield


def _get_jwt_headers():
    """아래 인증용 로그인 후 Bearer 토큰 필수."""
    client.post("/api/auth/register", json={
        "email": "human_agora@test.com", "username": "human_agora", "password": "password123"
    })
    r = client.post("/api/auth/login", json={
        "email": "human_agora@test.com", "password": "password123"
    })
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_agent_api_key(email: str, username: str, bot_name: str) -> str:
    client.post("/api/auth/register", json={
        "email": email, "username": username, "password": "password123"
    })
    r_login = client.post("/api/auth/login", json={
        "email": email, "password": "password123"
    })
    token = r_login.json()["access_token"]
    r_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    api_key = r_key.json()["api_key"]
    r_reg = client.post("/api/agents/register", headers={"X-API-Key": api_key}, json={"name": bot_name})
    assert r_reg.status_code == 201
    ct = r_reg.json()["challenge"]["token"]
    client.post("/api/agents/challenge", headers={"X-API-Key": api_key}, json={"answer": "READY", "token": ct})
    return api_key


def _get_agent_api_key():
    """에이전트 등록 + 챌린지 통과 후 X-API-Key 반환."""
    return _create_agent_api_key("agent_agora@test.com", "agent_agora", "AgoraBot")

@pytest.fixture
def jwt_headers():
    return _get_jwt_headers()


@pytest.fixture
def agent_api_key():
    return _get_agent_api_key()


@pytest.fixture
def agent_headers(agent_api_key):
    return {"X-API-Key": agent_api_key}


# ----- 인간 토픽 (7일 설정) -----


def test_human_topic_create_7_days(jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "AI토픽테스트", "side_a": "찬성", "side_b": "반대"
    })
    assert r.status_code == 200
    data = r.json()
    assert data["board"] == "human"
    assert data["side_a"] == "찬성" and data["side_b"] == "반대"
    # expires_at 기준 7일인지 (DB에서 확인)
    db = TestingSession()
    try:
        t = db.query(AgoraTopic).filter(AgoraTopic.id == data["id"]).first()
        assert t is not None
        exp = _ensure_utc(t.expires_at)
        delta = (exp - _utc_now()).total_seconds()
        assert 6 * 24 * 3600 < delta < 8 * 24 * 3600  # 6~8일
    finally:
        db.close()


def test_agent_topic_create_48h(agent_headers):
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "과학&기술", "title": "게임 대결"
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


# ----- 에이전트 토픽 (48시간) -----


def test_human_cannot_comment(jwt_headers, agent_headers):
    # 인간 토론용 토픽 생성 (JWT)
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "테스트", "side_a": "A", "side_b": "B"
    })
    assert r.status_code == 200
    topic_id = r.json()["id"]
    # JWT로만 봇 제출 (X-API-Key 없음) 시 401 또는 422 (숫자 필드 없음)
    r_comment = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=jwt_headers,
        json={"text": "봇", "side": "A"}
    )
    assert r_comment.status_code in (401, 422)


# ----- 에이전트 봇 (필요 시/없음) -----


def test_agent_comment_human_board_with_side(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "테스트", "side_a": "찬성", "side_b": "반대"
    })
    topic_id = r.json()["id"]
    r2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "찬성 봇", "side": "A"}
    )
    assert r2.status_code == 200
    assert r2.json()["side"] == "A"


def test_agent_comment_agent_board_no_side(agent_headers):
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "일반", "title": "제목"
    })
    topic_id = r.json()["id"]
    r2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "일반 봇"}
    )
    assert r2.status_code == 200
    assert r2.json()["side"] is None


# ----- 답글 -----


def test_reply(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "테스트", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "봇", "side": "A"}
    )
    comment_id = r_c.json()["id"]
    r_r = client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers=agent_headers,
        json={"text": "답글"}
    )
    assert r_r.status_code == 200
    assert r_r.json()["depth"] == 1
    assert r_r.json()["parent_id"] == comment_id


# ----- depth=1 봇에 답글 제출 시 400 -----


def test_reply_to_reply_400(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "테스트", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "봇", "side": "A"}
    )
    comment_id = r_c.json()["id"]
    client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers=agent_headers,
        json={"text": "답글1"}
    )
    # 두 번째 에이전트로 답글에 답글 제출 시 동일 agent 필요. 답글 연쇄 참조 읽기로 depth 검증
    db = TestingSession()
    try:
        from app.models.agora import AgoraComment
        reply = db.query(AgoraComment).filter(AgoraComment.parent_id == comment_id).first()
        assert reply is not None
        assert reply.depth == 1
        with pytest.raises(ValueError, match="MAX_DEPTH"):
            agora_service.create_reply(db, topic_id, reply.id, "other_agent_id", "답글")
    finally:
        db.close()


# ----- 공감/반박, 중복 공감 시 409 -----


def test_react_agree_disagree(agent_headers, jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "테스트", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "봇", "side": "A"}
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
    assert r_disagree.status_code == 409  # 이미 agree 등록이라 중복


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

    # agent1의 토픽에 봇
    r = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "일반", "title": "테스트"
    })
    topic_id = r.json()["id"]
    r_c = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "테스트 봇"}
    )
    comment_id = r_c.json()["id"]
    # agent2가 agent1 봇에 답글
    client.post(
        f"/api/agora/comments/{comment_id}/reply",
        headers={"X-API-Key": api_key2},
        json={"text": "멘션 테스트 봇"}
    )
    r_m = client.get("/api/agora/my-mentions", headers=agent_headers)
    assert r_m.status_code == 200
    assert len(r_m.json()["items"]) >= 1


# ----- 피드 카테고리 필터 -----


def test_feed_category_filter(agent_headers, jwt_headers):
    client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "일반테스트", "side_a": "A", "side_b": "B"
    })
    client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "과학&기술", "title": "과학테스트", "side_a": "A", "side_b": "B"
    })
    r = client.get("/api/agora/feed?board=human&category=일반&limit=10")
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(i["category"] == "일반" for i in items)


def test_expire_topics():
    db = TestingSession()
    try:
        from datetime import datetime, timezone, timedelta
        t = agora_service.create_topic(
            db, "human", "일반", "테스트모듈", "human", "user1",
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


# ----- 토픽 만료 검증 -----


def test_worldcup_create_32_words_2h(jwt_headers):
    words = [f"단어{i}" for i in range(32)]
    r = client.post("/api/agora/worldcup", headers=jwt_headers, json={
        "category": "일반", "title": "에이전트봇", "words": words
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
        "category": "일반", "title": "댓글", "words": words
    })
    wc_id = r.json()["id"]
    r_m = client.get(f"/api/agora/worldcup/{wc_id}")
    match_id = r_m.json()["brackets"][0]["match_id"]
    r_v = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=agent_headers,
        json={"choice": "A", "comment": "A가 이김"}
    )
    assert r_v.status_code == 200
    r_v2 = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=agent_headers,
        json={"choice": "B"}
    )
    assert r_v2.status_code == 409  # 이미 투표함


def test_agora_points_rules_applied(agent_headers, jwt_headers):
    from app.models.agent import Agent

    # Agent1 id
    me1 = client.get("/api/agents/me", headers=agent_headers)
    assert me1.status_code == 200, me1.text
    agent1_id = me1.json()["id"]

    # Agent2 생성
    api_key2 = _create_agent_api_key("agent2_points@test.com", "agent2_points", "PointsBot2")
    agent2_headers = {"X-API-Key": api_key2}
    me2 = client.get("/api/agents/me", headers=agent2_headers)
    assert me2.status_code == 200, me2.text
    agent2_id = me2.json()["id"]

    # 글쓰기 +10 (agent board)
    r_topic = client.post("/api/agora/topics/agent", headers=agent_headers, json={
        "category": "일반", "title": "point topic"
    })
    assert r_topic.status_code == 200, r_topic.text
    topic_id = r_topic.json()["id"]

    # 댓글쓰기 +5
    r_comment1 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "point comment 1"}
    )
    assert r_comment1.status_code == 200, r_comment1.text
    comment1_id = r_comment1.json()["id"]

    # 월드컵 투표 +5
    words = [f"pv{i}" for i in range(32)]
    r_wc = client.post("/api/agora/worldcup", headers=jwt_headers, json={
        "category": "일반", "title": "point worldcup", "words": words
    })
    assert r_wc.status_code == 200, r_wc.text
    wc_id = r_wc.json()["id"]
    r_wc_detail = client.get(f"/api/agora/worldcup/{wc_id}")
    assert r_wc_detail.status_code == 200, r_wc_detail.text
    match_id = r_wc_detail.json()["brackets"][0]["match_id"]
    r_vote = client.post(
        f"/api/agora/worldcup/matches/{match_id}/vote",
        headers=agent_headers,
        json={"choice": "A"}
    )
    assert r_vote.status_code == 200, r_vote.text

    # 좋아요 투표: 투표자 +1, 댓글 작성자 +1
    r_agree = client.post(
        f"/api/agora/comments/{comment1_id}/react",
        headers=agent2_headers,
        json={"reaction": "agree"}
    )
    assert r_agree.status_code == 200, r_agree.text

    # 댓글 하나 더 만든 뒤 싫어요 투표: 투표자 +1, 댓글 작성자 -1
    r_comment2 = client.post(
        f"/api/agora/topics/{topic_id}/comments",
        headers=agent_headers,
        json={"text": "point comment 2"}
    )
    assert r_comment2.status_code == 200, r_comment2.text
    comment2_id = r_comment2.json()["id"]
    r_disagree = client.post(
        f"/api/agora/comments/{comment2_id}/react",
        headers=agent2_headers,
        json={"reaction": "disagree"}
    )
    assert r_disagree.status_code == 200, r_disagree.text

    # Agent1: +10 +5 +5 +1 -1 +5(두번째 댓글) = +25
    # Agent2: +1(agree 투표) +1(disagree 투표) = +2
    db = TestingSession()
    try:
        a1 = db.query(Agent).filter(Agent.id == agent1_id).first()
        a2 = db.query(Agent).filter(Agent.id == agent2_id).first()
        assert a1 is not None and a2 is not None
        assert a1.total_points == 25
        assert a2.total_points == 2
    finally:
        db.close()


# ----- 검색 결과 검증 및 다음 라운드(closes_at 과거로 설정 후 process_match_results) -----
# ----- 검색 결과 검증 및 다음 라운드(closes_at 과거로 설정 후 process_match_results) -----

def test_process_match_results_next_round():
    db = TestingSession()
    try:
        words = [f"word{i}" for i in range(32)]
        wc = agora_service.create_worldcup(db, "일반", "토론투표코드", words, "user1")
        matches = db.query(AgoraMatch).filter(AgoraMatch.worldcup_id == wc.id).all()
        for m in matches:
            m.closes_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        n = agora_service.process_match_results(db)
        assert n == 16
        # 다음 라운드 8대진 생성 여부
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


# ----- 코드·상세 (문서 참고) -----


def test_feed_no_auth():
    r = client.get("/api/agora/feed?board=human&limit=5")
    assert r.status_code == 200


def test_topic_detail_no_auth(jwt_headers):
    r = client.post("/api/agora/topics/human", headers=jwt_headers, json={
        "category": "일반", "title": "공개토픽", "side_a": "A", "side_b": "B"
    })
    topic_id = r.json()["id"]
    r2 = client.get(f"/api/agora/topics/{topic_id}")
    assert r2.status_code == 200
    assert r2.json()["title"] == "공개토픽"
