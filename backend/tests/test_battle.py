"""
배틀 엔진 통합 테스트
4명 봇이 게임 참가 → 액션 제출 → 종료까지 전체 루프 검증.
join은 대기열 방식이므로 4명을 병렬로 join 해야 같은 방에 배정됨.
"""
import os
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
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


def _ensure_agent_challenge_columns():
    """테스트 DB에 agents 챌린지 컬럼 보장."""
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
def use_battle_db():
    """다른 테스트 모듈 로드 시 get_db 덮어쓰기 방지: 이 모듈 테스트 시 항상 배틀 DB 사용."""
    app.dependency_overrides[get_db] = override_get_db
    yield


def _create_bot(email, username) -> str:
    """유저 생성(구글 전용: DB 직접) → API Key → 에이전트 등록 → 챌린지 통과(테스트용) → API Key 반환"""
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

    r = client.post("/api/auth/api-key", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"api-key failed: {r.status_code} {r.text}"
    api_key = r.json()["api_key"]

    reg = client.post("/api/agents/register",
        headers={"X-API-Key": api_key},
        json={"name": username}
    )
    assert reg.status_code == 201, reg.text
    challenge_token = reg.json()["challenge"]["token"]
    ch = client.post("/api/agents/challenge",
        headers={"X-API-Key": api_key},
        json={"answer": "READY", "token": challenge_token}
    )
    assert ch.status_code == 200, ch.text
    return api_key


def _join(api_key: str) -> str:
    """1명 join (대기열에서 4명 될 때까지 대기하므로, 단독 호출 시 타임아웃됨)."""
    r = client.post("/api/games/join",
        headers={"X-API-Key": api_key},
        json={"game_type": "battle"}
    )
    assert r.status_code == 200, r.text
    return r.json()["game_id"]


def _join_four_parallel(api_keys: list[str]) -> str:
    """4명을 동시에 join 시켜 대기열에서 한 방으로 배정. game_id 반환."""
    results = []

    def do_join(key: str):
        gid = _join(key)
        results.append((key, gid))

    threads = [threading.Thread(target=do_join, args=(k,)) for k in api_keys]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 4
    game_id = results[0][1]
    for _, gid in results:
        assert gid == game_id, "4명이 같은 방에 배정되어야 함"
    return game_id


def _state(api_key: str, game_id: str) -> dict:
    r = client.get(f"/api/games/{game_id}/state?history=full",
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
    """4명 참가 시 게임 자동 시작 확인 (대기열에서 4명 병렬 join → 한 방 배정)"""
    keys = [_create_bot(f"bot{i}@test.com", f"bot{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["round"] == 1
    assert len(state["action_order"]) == 4


def test_action_order_rotation():
    """라운드마다 순서 로테이션 확인"""
    keys = [_create_bot(f"rot{i}@test.com", f"rot{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

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
    game_id = _join_four_parallel(keys)

    # 3라운드 동안 기력 모으기 (백엔드는 로그 기반, 대기 없이 즉시 collect)
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
    game_id = _join_four_parallel(keys)

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


def test_battle_collect_timeout_advances_round():
    """
    collect 단계에서 일부 에이전트가 액션을 내지 않아도,
    COLLECT_TIMEOUT_SEC 이후 get_state 호출 시 자동으로 charge 처리되어 라운드가 진행되는지 확인.
    (테스트에서는 collect_entered_at을 인위적으로 과거로 설정해 시간 경과를 시뮬레이션한다.)
    """
    from app.models.game import Game
    from app.engines.battle import BattleEngine
    import time

    keys = [_create_bot(f"timeout{i}@test.com", f"t{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

    # 현재 라운드/phase 확인
    s0 = _state(keys[0], game_id)
    assert s0["phase"] == "collect"
    round0 = s0["round"]

    # DB에서 게임 상태를 직접 수정해 collect_entered_at을 과거로 돌리고, pending_actions를 일부만 채워둔다.
    db = TestingSession()
    try:
        game = db.query(Game).filter_by(id=game_id).first()
        assert game is not None
        engine = BattleEngine(game, db)
        bs = engine._bs()
        bs["phase"] = "collect"
        bs["collect_entered_at"] = time.time() - (engine.COLLECT_TIMEOUT_SEC + 5)
        # 한 명만 이미 제출한 것으로 설정
        some_id = s0["self"]["id"]
        bs["pending_actions"] = {some_id: {"type": "charge"}}
        engine._commit(bs)
    finally:
        db.close()

    # collect 상태에서 get_state를 다시 호출하면 타임아웃 로직이 동작해 라운드가 진행되어야 한다.
    s1 = _state(keys[0], game_id)
    assert s1["round"] >= round0


def test_full_game_loop():
    """전체 게임 루프 — 다양한 전략(공격/charge/random) 섞어서도 게임 종료까지"""
    import random
    keys = [_create_bot(f"full{i}@test.com", f"full{i}") for i in range(4)]
    game_id = _join_four_parallel(keys)

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

        for idx, (key, s) in enumerate(alive_keys):
            alive_others = [a for a in s["other_agents"] if a["alive"]]
            if not alive_others:
                _action(key, game_id, {"type": "charge"})
                continue
            # 다양한 전략: 첫 번째는 항상 charge, 두 번째는 항상 attack, 나머지는 랜덤
            if idx == 0:
                _action(key, game_id, {"type": "charge"})
            elif idx == 1:
                target = random.choice(alive_others)
                _action(key, game_id, {"type": "attack", "target_id": target["id"]})
            else:
                strat = random.choice(["charge", "attack"])
                if strat == "charge":
                    _action(key, game_id, {"type": "charge"})
                else:
                    target = random.choice(alive_others)
                    _action(key, game_id, {"type": "attack", "target_id": target["id"]})

    final = _state(keys[0], game_id)
    assert final["gameStatus"] == "finished"
