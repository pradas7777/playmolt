"""
타임아웃 처리 체크리스트 테스트.
- 배틀: 1명만 액션 제출, 테스트용 timeout 2초 설정 후 나머지 자동 charge 처리·게임 진행 확인.
"""
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

os.environ["DATABASE_URL"] = "sqlite:///./test_timeout.db"

from app.main import app
from app.core.database import Base, get_db
from app.models.game import Game, GameStatus

TEST_DB_URL = "sqlite:///./test_timeout.db"
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


def _create_bot(email: str, username: str) -> str:
    client.post("/api/auth/register", json={
        "email": email, "username": username, "password": "password123"
    })
    token = client.post("/api/auth/login", json={
        "email": email, "password": "password123"
    }).json()["access_token"]
    api_key = client.post("/api/auth/api-key",
        headers={"Authorization": f"Bearer {token}"}
    ).json()["api_key"]
    reg = client.post("/api/agents/register",
        headers={"X-API-Key": api_key},
        json={"name": username}
    )
    assert reg.status_code == 201, reg.text
    challenge_token = reg.json()["challenge"]["token"]
    client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "READY", "token": challenge_token}
    )
    return api_key


def _join_four_parallel(api_keys: list[str]) -> str:
    results = []

    def do_join(key: str):
        r = client.post("/api/games/join", headers={"X-API-Key": key}, json={"game_type": "battle"})
        assert r.status_code == 200, r.text
        results.append((key, r.json()["game_id"]))

    threads = [threading.Thread(target=do_join, args=(k,)) for k in api_keys]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 4
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


def test_battle_timeout_one_submit_then_auto_charge():
    """배틀: 1명만 액션 제출, 테스트용 timeout 2초 후 나머지 자동 charge 처리·게임 진행."""
    keys = [_create_bot(f"t{i}@test.com", f"t{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

    # 게임 시작 직후 상태 확인
    state0 = _state(keys[0], game_id)
    assert state0["gameStatus"] == "running"
    assert state0["round"] == 1

    # 테스트용: timeout 2초, collect_entered_at을 3초 전으로 설정해 이미 타임아웃 상태로 만듦
    db = TestingSession()
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        assert game is not None
        cfg = dict(game.config or {})
        cfg["phase_timeout_seconds"] = 2
        bs = dict(cfg.get("battle_state") or {})
        bs["collect_entered_at"] = time.time() - 3
        cfg["battle_state"] = bs
        game.config = cfg
        flag_modified(game, "config")
        db.commit()
    finally:
        db.close()

    # 1명만 제출
    _action(keys[0], game_id, {"type": "charge"})

    # get_state 호출 시 타임아웃 적용됨 (배틀 엔진이 collect 단계에서 _maybe_apply_collect_timeout 호출)
    state1 = _state(keys[0], game_id)

    # 타임아웃으로 미제출 3명이 charge 처리되어 라운드가 진행되어야 함
    assert state1["round"] >= 2 or state1["gameStatus"] == "finished", (
        "타임아웃 적용 후 라운드 진행 또는 게임 종료되어야 함"
    )


def test_battle_timeout_via_apply_phase_timeout():
    """apply_phase_timeout() 호출로 미제출자 charge 주입 후 진행 확인."""
    from app.services.game_service import get_engine

    keys = [_create_bot(f"t2_{i}@test.com", f"t2_{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

    # 먼저 타임아웃이 아직 안 지나게 설정 (1명 제출 시 process_action 내부에서 타임아웃 적용되지 않도록)
    db = TestingSession()
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        assert game is not None
        cfg = dict(game.config or {})
        cfg["phase_timeout_seconds"] = 2
        bs = dict(cfg.get("battle_state") or {})
        bs["collect_entered_at"] = time.time()  # 아직 타임아웃 아님
        cfg["battle_state"] = bs
        game.config = cfg
        flag_modified(game, "config")
        db.commit()
    finally:
        db.close()

    # 1명만 제출 (이 시점에서는 타임아웃 미도달이라 라운드 진행 안 됨)
    _action(keys[0], game_id, {"type": "charge"})

    # 이제 collect_entered_at을 과거로 바꿔서 스케줄러가 타임아웃 적용하도록 함
    db = TestingSession()
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        assert game is not None
        cfg = dict(game.config or {})
        bs = dict(cfg.get("battle_state") or {})
        bs["collect_entered_at"] = time.time() - 3
        cfg["battle_state"] = bs
        game.config = cfg
        flag_modified(game, "config")
        db.commit()
        db.refresh(game)

        engine = get_engine(game, db)
        applied = engine.apply_phase_timeout()
        assert applied is True, "타임아웃 적용 시 True 반환"
    finally:
        db.close()

    state = _state(keys[0], game_id)
    assert state["round"] >= 2 or state["gameStatus"] == "finished"
