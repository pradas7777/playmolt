"""
모의재판(Trial) 엔진 통합 테스트.
5명 봇 참가 → opening(ready) → jury_first → argument_1 → jury_second → argument_2 → jury_final → verdict.
"""
import os
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = "sqlite:///./test_trial.db"

from app.main import app
from app.core.database import Base, get_db

TEST_DB_URL = "sqlite:///./test_trial.db"
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
def use_trial_db():
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


def _key_for_agent_id(keys: list[str], game_id: str, agent_id: str) -> str | None:
    for key in keys:
        if _state(key, game_id)["self"].get("id") == agent_id:
            return key
    return None


def test_trial_5_bots_full_flow():
    """5명 참가 → opening → jury×3 → argument×2 → verdict 종료"""
    keys = [_create_bot(f"trial{i}@test.com", f"trial{i}") for i in range(5)]
    game_id = _join_n_parallel(keys, "trial", 5)

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["gameType"] == "trial"
    assert state["phase"] == "opening"

    # opening: 전원 ready
    for key in keys:
        resp = _action(key, game_id, {"type": "ready"})
        assert resp.get("success") is True, resp

    def get_keys_by_role(keys, game_id, role_filter):
        s = _state(keys[0], game_id)
        ids = [p["id"] for p in s["participants"] if p.get("role") in role_filter]
        return [_key_for_agent_id(keys, game_id, aid) for aid in ids if _key_for_agent_id(keys, game_id, aid)]

    # jury_first → argument_1 → jury_second → argument_2 → jury_final → verdict 순서로 제출
    for step in range(10):
        state = _state(keys[0], game_id)
        if state["gameStatus"] == "finished":
            break
        if state["phase"] in ("jury_first", "jury_second", "jury_final"):
            for key in get_keys_by_role(keys, game_id, ["JUROR"]):
                resp = _action(key, game_id, {"type": "vote", "verdict": "GUILTY"})
                assert resp.get("success") is True, resp
        elif state["phase"] in ("argument_1", "argument_2"):
            for key in get_keys_by_role(keys, game_id, ["PROSECUTOR", "DEFENSE"]):
                resp = _action(key, game_id, {"type": "speak", "text": "argument"})
                assert resp.get("success") is True, resp

    final = _state(keys[0], game_id)
    assert final["gameStatus"] == "finished"
    assert final.get("phase") == "verdict" or final.get("result") is not None
    assert any(h.get("phase") == "verdict" for h in final.get("history", []))


def test_trial_invalid_then_fix_action():
    """잘못된 type 전송 후 expected_action / hint를 보고 수정해서 다시 보내는 시나리오."""
    keys = [_create_bot(f"trial_err{i}@test.com", f"ter{i}") for i in range(5)]
    game_id = _join_n_parallel(keys, "trial", 5)

    # opening: 전원 ready
    for key in keys:
        resp = _action(key, game_id, {"type": "ready"})
        assert resp.get("success") is True, resp

    # jury_first 단계에서 한 배심원이 잘못된 type(speak)을 보내고, 이후 vote로 수정
    def get_keys_by_role(keys, game_id, role_filter):
        s = _state(keys[0], game_id)
        ids = [p["id"] for p in s["participants"] if p.get("role") in role_filter]
        return [_key_for_agent_id(keys, game_id, aid) for aid in ids if _key_for_agent_id(keys, game_id, aid)]

    # jury_first까지 진행되었는지 확인
    state = _state(keys[0], game_id)
    assert state["phase"] in ("jury_first", "jury_second", "jury_final")

    juror_keys = get_keys_by_role(keys, game_id, ["JUROR"])
    assert juror_keys, "JUROR 역할이 있어야 합니다."
    juror_key = juror_keys[0]

    # 잘못된 액션: speak 전송
    bad_resp = client.post(
        f"/api/games/{game_id}/action",
        headers={"X-API-Key": juror_key},
        json={"type": "speak", "text": "wrong"},
    )
    assert bad_resp.status_code == 400
    payload = bad_resp.json()
    err = payload.get("detail") or {}
    assert err.get("success") is False
    assert err.get("expected_action") == "vote"
    assert "vote" in (err.get("hint") or "").lower()

    # 올바른 vote 액션으로 재시도
    good_resp = client.post(
        f"/api/games/{game_id}/action",
        headers={"X-API-Key": juror_key},
        json={"type": "vote", "verdict": "GUILTY"},
    )
    assert good_resp.status_code == 200
    body = good_resp.json()
    assert body.get("success") is True