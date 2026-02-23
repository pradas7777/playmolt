"""
배틀 엔진 통합 테스트
4명 봇이 게임 참가 → 액션 제출 → 종료까지 전체 루프 검증
"""
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# app.main 로드 전에 테스트 DB URL 설정 (실제 PostgreSQL 연결 방지)
os.environ["DATABASE_URL"] = "sqlite:///./test_battle.db"

from app.main import app
from app.core.database import Base, get_db

TEST_DB_URL = "sqlite:///./test_battle.db"
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


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


def _create_bot(email, username) -> str:
    """유저 생성 → 로그인 → API Key → 에이전트 등록 → API Key 반환"""
    client.post("/api/auth/register", json={
        "email": email, "username": username, "password": "password123"
    })
    token = client.post("/api/auth/login", json={
        "email": email, "password": "password123"
    }).json()["access_token"]

    api_key = client.post("/api/auth/api-key",
        headers={"Authorization": f"Bearer {token}"}
    ).json()["api_key"]

    client.post("/api/agents/register",
        headers={"X-API-Key": api_key},
        json={"name": username}
    )
    return api_key


def _join(api_key: str) -> str:
    r = client.post("/api/games/join",
        headers={"X-API-Key": api_key},
        json={"game_type": "battle"}
    )
    assert r.status_code == 200, r.text
    return r.json()["game_id"]


def _state(api_key: str, game_id: str) -> dict:
    r = client.get(f"/api/games/{game_id}/state",
        headers={"X-API-Key": api_key}
    )
    assert r.status_code == 200, r.text
    return r.json()


def _action(api_key: str, game_id: str, action: dict) -> dict:
    r = client.post(f"/api/games/{game_id}/action",
        headers={"X-API-Key": api_key},
        json=action
    )
    return r.json()


# ── 테스트 ─────────────────────────────────────────────

def test_4_bots_join_and_game_starts():
    """4명 참가 시 게임 자동 시작 확인"""
    keys = [_create_bot(f"bot{i}@test.com", f"bot{i}") for i in range(4)]

    game_id = None
    for key in keys:
        gid = _join(key)
        if game_id is None:
            game_id = gid
        assert gid == game_id  # 같은 방에 배정

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["round"] == 1
    assert len(state["action_order"]) == 4


def test_action_order_rotation():
    """라운드마다 순서 로테이션 확인"""
    keys = [_create_bot(f"rot{i}@test.com", f"rot{i}") for i in range(4)]
    game_id = _join(keys[0])
    for key in keys[1:]:
        _join(key)

    state = _state(keys[0], game_id)
    order_r1 = state["action_order"]

    # 1라운드 전원 charge 제출
    for key in keys:
        _action(key, game_id, {"type": "charge"})

    state2 = _state(keys[0], game_id)
    order_r2 = state2["action_order"]

    # 첫 번째가 뒤로 이동했는지 확인
    assert order_r2[0] == order_r1[1]
    assert order_r2[-1] == order_r1[0]


def test_attack_kills_target():
    """기력 3 공격 → 타겟 HP 4 → 1칸 확인"""
    keys = [_create_bot(f"atk{i}@test.com", f"atk{i}") for i in range(4)]
    game_id = _join(keys[0])
    for key in keys[1:]:
        _join(key)

    # 3라운드 동안 기력 모으기
    for _ in range(3):
        for key in keys:
            _action(key, game_id, {"type": "charge"})

    state = _state(keys[0], game_id)
    my_id = state["self"]["id"]
    assert state["self"]["energy"] == 3

    # 타겟 선택
    target = state["other_agents"][0]
    target_id = target["id"]
    target_key = None
    for key in keys:
        s = _state(key, game_id)
        if s["self"]["id"] == target_id:
            target_key = key
            break

    # 공격자만 attack, 나머지는 charge
    for key in keys:
        s = _state(key, game_id)
        if s["self"]["id"] == my_id:
            _action(key, game_id, {"type": "attack", "target_id": target_id})
        else:
            _action(key, game_id, {"type": "charge"})

    # 타겟 HP 확인 (4 - 4 = 0 or 1 depending on timing)
    if target_key:
        t_state = _state(target_key, game_id)
        assert t_state["self"]["hp"] <= 1


def test_defend_blocks_attack():
    """방어가 공격을 흡수하는지 확인"""
    keys = [_create_bot(f"def{i}@test.com", f"def{i}") for i in range(4)]
    game_id = _join(keys[0])
    for key in keys[1:]:
        _join(key)

    state = _state(keys[0], game_id)
    my_id = state["self"]["id"]
    target = state["other_agents"][0]
    target_id = target["id"]
    target_key = next(
        k for k in keys
        if _state(k, game_id)["self"]["id"] == target_id
    )

    # 공격자 attack, 타겟 defend, 나머지 charge
    for key in keys:
        s = _state(key, game_id)
        sid = s["self"]["id"]
        if sid == my_id:
            _action(key, game_id, {"type": "attack", "target_id": target_id})
        elif sid == target_id:
            _action(key, game_id, {"type": "defend"})
        else:
            _action(key, game_id, {"type": "charge"})

    # 방어 성공 → HP 그대로
    t_state = _state(target_key, game_id)
    assert t_state["self"]["hp"] == 4


def test_full_game_loop():
    """전체 게임 루프 — 모두 공격해서 게임 종료까지"""
    import random
    keys = [_create_bot(f"full{i}@test.com", f"full{i}") for i in range(4)]
    game_id = _join(keys[0])
    for key in keys[1:]:
        _join(key)

    max_rounds = 20
    for _ in range(max_rounds):
        state = _state(keys[0], game_id)
        if state["gameStatus"] == "finished":
            break

        alive_keys = []
        for key in keys:
            s = _state(key, game_id)
            if s["self"]["isAlive"] and s["gameStatus"] == "running":
                alive_keys.append((key, s))

        if not alive_keys:
            break

        for key, s in alive_keys:
            alive_others = [a for a in s["other_agents"] if a["alive"]]
            if alive_others:
                target = random.choice(alive_others)
                _action(key, game_id, {"type": "attack", "target_id": target["id"]})
            else:
                _action(key, game_id, {"type": "charge"})

    final = _state(keys[0], game_id)
    assert final["gameStatus"] == "finished"
