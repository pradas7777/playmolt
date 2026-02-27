"""
마피아(워드 울프) 엔진 통합 테스트.
6명 봇 참가 → 힌트 제출 → 투표 → 결과까지 전체 루프 검증.
"""
import os
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = "sqlite:///./test_mafia.db"

from app.main import app
from app.core.database import Base, get_db

TEST_DB_URL = "sqlite:///./test_mafia.db"
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


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    _ensure_agent_challenge_columns()
    yield


@pytest.fixture(autouse=True)
def use_mafia_db():
    app.dependency_overrides[get_db] = override_get_db
    yield


def _create_bot(email: str, username: str) -> str:
    from app.models.user import User
    from app.core.security import create_access_token
    db = TestingSession()
    try:
        user = User(email=email, username=username, password_hash=None)
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id)
    finally:
        db.close()
    api_key = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"}).json()["api_key"]
    reg = client.post("/api/agents/register", headers={"X-API-Key": api_key}, json={"name": username})
    assert reg.status_code == 201, reg.text
    ch = client.post("/api/agents/challenge", headers={"X-API-Key": api_key},
                     json={"answer": "READY", "token": reg.json()["challenge"]["token"]})
    assert ch.status_code == 200, ch.text
    return api_key


def _join(api_key: str, game_type: str) -> str:
    r = client.post("/api/games/join", headers={"X-API-Key": api_key}, json={"game_type": game_type})
    assert r.status_code == 200, r.text
    return r.json()["game_id"]


def _join_n_parallel(api_keys: list[str], game_type: str, n: int) -> str:
    results = []

    def do_join(key: str):
        gid = _join(key, game_type)
        results.append((key, gid))

    threads = [threading.Thread(target=do_join, args=(k,)) for k in api_keys[:n]]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == n
    game_id = results[0][1]
    for _, gid in results:
        assert gid == game_id
    return game_id


def _state(api_key: str, game_id: str) -> dict:
    r = client.get(f"/api/games/{game_id}/state", headers={"X-API-Key": api_key})
    assert r.status_code == 200, r.text
    return r.json()


def _action(api_key: str, game_id: str, action: dict) -> dict:
    r = client.post(f"/api/games/{game_id}/action", headers={"X-API-Key": api_key}, json=action)
    return r.json()


def test_mafia_6_bots_full_flow():
    """6명 참가 → 힌트 1라운드 → 투표 → 게임 종료·결과 확인"""
    keys = [_create_bot(f"maf{i}@test.com", f"maf{i}") for i in range(6)]
    game_id = _join_n_parallel(keys, "mafia", 6)

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["gameType"] == "mafia"
    assert state["phase"] == "hint"

    # 힌트 제출 (6명)
    for key in keys:
        resp = _action(key, game_id, {"type": "hint", "text": "test hint"})
        assert resp.get("success") is True, resp

    state = _state(keys[0], game_id)
    assert state["phase"] == "vote"

    # 투표: 모두 동일 1명에게 투표해 한 명 추방
    s0 = _state(keys[0], game_id)
    others = [p for p in s0.get("participants", []) if p["id"] != s0["self"]["id"]]
    assert len(others) >= 1
    target_id = others[0]["id"]
    for key in keys:
        s = _state(key, game_id)
        if s["self"]["id"] == target_id:
            tid = [p["id"] for p in s["participants"] if p["id"] != target_id][0]
        else:
            tid = target_id
        resp = _action(key, game_id, {"type": "vote", "target_id": tid, "reason": "test"})
        assert resp.get("success") is True, resp

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "finished"
    assert "result" in state or state.get("phase") == "result"
    history = state.get("history", [])
    assert any(h.get("phase") == "vote_result" for h in history)
