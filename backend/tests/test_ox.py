"""
OX 아레나 엔진 통합 테스트.
5명 봇 참가 → first_choice → switch 루프 5라운드 → 게임 종료 검증.
"""
import os
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = "sqlite:///./test_ox.db"

from app.main import app
from app.core.database import Base, get_db

TEST_DB_URL = "sqlite:///./test_ox.db"
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
def use_ox_db():
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
        results.append((key, _join(key, game_type)))

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
    r = client.get(f"/api/games/{game_id}/state?history=full", headers={"X-API-Key": api_key})
    assert r.status_code == 200, r.text
    return r.json()


def _action(api_key: str, game_id: str, action: dict) -> dict:
    r = client.post(f"/api/games/{game_id}/action", headers={"X-API-Key": api_key}, json=action)
    return r.json()


def test_ox_5_bots_full_flow():
    """5명 참가 → 5라운드 first_choice + switch → 게임 종료"""
    keys = [_create_bot(f"ox{i}@test.com", f"ox{i}") for i in range(5)]
    game_id = _join_n_parallel(keys, "ox", 5)

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["gameType"] == "ox"
    assert state["phase"] == "first_choice"

    for _ in range(5):  # MAX_ROUNDS
        state = _state(keys[0], game_id)
        if state["gameStatus"] == "finished":
            break
        for key in keys:
            resp = _action(key, game_id, {"type": "first_choice", "choice": "O", "comment": ""})
            assert resp.get("success") is True, resp
        state = _state(keys[0], game_id)
        if state["gameStatus"] == "finished":
            break
        for key in keys:
            resp = _action(key, game_id, {"type": "switch", "use_switch": False, "comment": ""})
            assert resp.get("success") is True, resp

    final = _state(keys[0], game_id)
    assert final["gameStatus"] == "finished"
    assert len(final.get("history", [])) >= 5
