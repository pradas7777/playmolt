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


def test_ox_invalid_action_uses_default_and_advances_phase():
    """first_choice/switch 에서 잘못된 type 을 보내도 default_action 으로 처리되어 게임이 진행되는지 검사."""
    keys = [_create_bot(f"ox_invalid{i}@test.com", f"ox_invalid{i}") for i in range(5)]
    game_id = _join_n_parallel(keys, "ox", 5)

    # first_choice 단계에서 첫 번째 에이전트는 잘못된 type 전송
    bad_resp = _action(keys[0], game_id, {"type": "switch", "use_switch": True, "comment": "wrong phase"})
    assert bad_resp.get("success") is False
    assert bad_resp.get("error") == "FIRST_CHOICE_PHASE"
    assert bad_resp.get("expected_action") == "first_choice"

    # 나머지 에이전트는 정상 first_choice
    for key in keys[1:]:
        resp = _action(key, game_id, {"type": "first_choice", "choice": "O", "comment": ""})
        assert resp.get("success") is True, resp

    # first_choice 가 모두 채워지면 자동으로 reveal → switch 로 넘어가야 한다.
    state = _state(keys[0], game_id)
    assert state["phase"] in ("reveal", "switch", "final_result")

    # switch 단계에서도 잘못된 type 을 보내면 default switch 로 처리되고 진행되어야 한다.
    if state["phase"] != "switch":
        # reveal 이면 한 번 더 상태 조회해서 switch 까지 넘긴다.
        state = _state(keys[0], game_id)
    assert state["phase"] in ("switch", "final_result")

    # 아직 final_result 가 아니라면 switch 액션을 보낸다.
    if state["phase"] == "switch":
        bad_resp2 = _action(keys[0], game_id, {"type": "first_choice", "choice": "X", "comment": "wrong in switch"})
        assert bad_resp2.get("success") is False
        assert bad_resp2.get("error") == "SWITCH_PHASE"
        assert bad_resp2.get("expected_action") == "switch"
        for key in keys[1:]:
            resp = _action(key, game_id, {"type": "switch", "use_switch": False, "comment": ""})
            assert resp.get("success") is True, resp

    # 라운드가 정상 진행되어 history 에 최소 1라운드 결과가 쌓였는지 확인.
    final = _state(keys[0], game_id)
    assert len(final.get("history", [])) >= 1
    last = final["history"][-1]
    assert "distribution" in last
    assert "choices" in last


def test_ox_timeout_applies_default_actions_and_advances_phase():
    """first_choice 타임아웃 시 default_action 으로 채우고 다음 phase 로 넘어가는지 검사."""
    keys = [_create_bot(f"ox_timeout{i}@test.com", f"ox_timeout{i}") for i in range(5)]
    game_id = _join_n_parallel(keys, "ox", 5)

    # 한 명만 first_choice 제출, 나머지는 제출하지 않고 타임아웃을 강제로 발생시킨다.
    resp = _action(keys[0], game_id, {"type": "first_choice", "choice": "O", "comment": ""})
    assert resp.get("success") is True, resp

    # DB 의 ox_state.phase_started_at 을 과거로 밀어서 타임아웃 조건을 만족시키고 apply_phase_timeout 을 호출한다.
    from app.core.database import get_db
    from app.models.game import Game
    from app.engines.ox import OxEngine

    db = next(override_get_db())
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        assert game is not None
        os = (game.config or {}).get("ox_state") or {}
        os["phase_started_at"] = 0  # 오래전에 시작된 것으로 처리
        game.config = (game.config or {}) | {"ox_state": os}
        db.commit()

        engine = OxEngine(game, db)
        changed = engine.apply_phase_timeout()
        assert changed is True
    finally:
        db.close()

    state = _state(keys[0], game_id)
    # 타임아웃 후에는 최소한 reveal 또는 그 이후 phase 로 넘어가 있어야 한다.
    assert state["phase"] in ("reveal", "switch", "final_result")
