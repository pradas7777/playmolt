"""
모의재판(Trial) 엔진 통합 테스트.
흐름: opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict.
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


def get_keys_by_role(keys: list, game_id: str, role_filter: list) -> list:
    s = _state(keys[0], game_id)
    ids = [p["id"] for p in s["participants"] if p.get("role") in role_filter]
    return [_key_for_agent_id(keys, game_id, aid) for aid in ids if _key_for_agent_id(keys, game_id, aid)]


# 변론·질문·이유 예시 (history/로그 확인용)
EXAMPLE_CLAIM_ARG1_PRO = "해당 증거는 피고의 유죄를 뒷받침합니다. 1차 주장을 제출합니다."
EXAMPLE_CLAIM_ARG1_DEF = "해당 반증은 피고의 무죄를 뒷받침합니다. 1차 반박을 제출합니다."
EXAMPLE_CLAIM_ARG2_PRO = "판사가 제시한 추가 증거를 반영하여 2차 주장에서 유죄 입장을 재강화합니다."
EXAMPLE_CLAIM_ARG2_DEF = "판사 추가 증거를 반영하여 2차 반박에서 무죄 입장을 재강화합니다."
EXAMPLE_JURY_INTERIM_REASON = "검찰·변호 1차 주장을 종합했을 때 추가 질문이 필요하다고 봅니다."
EXAMPLE_JURY_INTERIM_QUESTION = "증거의 시점과 피고인 연관성이 공식 기록으로 입증되었는지 확인이 필요합니다."
EXAMPLE_JUDGE_QUESTION_SUMMARY = "배심원 질문 요약: 증거 시점·연관성·공식 기록 입증 여부 확인 요청."
EXAMPLE_JUDGE_ADDED_FACT = {"title": "추가 상황: 목격자 보조 진술서 접수", "detail": "재판 중 목격자 보조 진술서가 제출되었으며, 당일 시간대와 장소에 대한 내용이 포함되어 있습니다."}
EXAMPLE_JURY_FINAL_REASON = "1·2차 변론과 판사의 추가 증거를 모두 고려한 결과, 합리적 의심을 넘어선 판단입니다."


def test_trial_6_bots_full_flow():
    """6명 참가 → opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict"""
    keys = [_create_bot(f"trial{i}@test.com", f"trial{i}") for i in range(6)]
    game_id = _join_n_parallel(keys, "trial", 6)

    state = _state(keys[0], game_id)
    assert state["gameStatus"] == "running"
    assert state["gameType"] == "trial"
    assert state["phase"] == "opening"

    # opening: 전원 ready
    for key in keys:
        resp = _action(key, game_id, {"type": "ready"})
        assert resp.get("success") is True, resp

    # argument_1: 검사/변호만 arg1 (evidence_key는 case에서 선택)
    state = _state(keys[0], game_id)
    assert state["phase"] == "argument_1"
    case = state.get("case", {})
    ev_for = case.get("evidence_for") or ["증거"]
    ev_against = case.get("evidence_against") or ["반증"]
    for key in get_keys_by_role(keys, game_id, ["PROSECUTOR"]):
        resp = _action(key, game_id, {"type": "arg1", "evidence_key": ev_for[0], "claim": EXAMPLE_CLAIM_ARG1_PRO})
        assert resp.get("success") is True, resp
    for key in get_keys_by_role(keys, game_id, ["DEFENSE"]):
        resp = _action(key, game_id, {"type": "arg1", "evidence_key": ev_against[0], "claim": EXAMPLE_CLAIM_ARG1_DEF})
        assert resp.get("success") is True, resp

    # jury_interim: 배심원 3명 verdict+reason+question (예시 텍스트로 로그 확인 가능)
    state = _state(keys[0], game_id)
    assert state["phase"] == "jury_interim"
    for key in get_keys_by_role(keys, game_id, ["JUROR"]):
        resp = _action(key, game_id, {
            "type": "jury_interim",
            "verdict": "GUILTY",
            "reason": EXAMPLE_JURY_INTERIM_REASON,
            "question": EXAMPLE_JURY_INTERIM_QUESTION,
        })
        assert resp.get("success") is True, resp

    # judge_expand: 판사 1명 (예시 텍스트)
    state = _state(keys[0], game_id)
    assert state["phase"] == "judge_expand"
    for key in get_keys_by_role(keys, game_id, ["JUDGE"]):
        resp = _action(key, game_id, {
            "type": "judge_expand",
            "question_summary": EXAMPLE_JUDGE_QUESTION_SUMMARY,
            "added_fact": EXAMPLE_JUDGE_ADDED_FACT,
            "new_evidence_for": [{"key": "(판사추가)검찰 추가 증거", "note": "요약"}],
            "new_evidence_against": [{"key": "(판사추가)변호 추가 증거", "note": "요약"}],
        })
        assert resp.get("success") is True, resp

    # argument_2: 검사/변호 arg2 (expansion 신규 증거 키 사용, 예시 변론문)
    state = _state(keys[0], game_id)
    assert state["phase"] == "argument_2"
    expansion = state.get("expansion") or {}
    keys_new = [e.get("key", "") for e in (expansion.get("new_evidence_for") or []) if e.get("key")]
    keys_new += [e.get("key", "") for e in (expansion.get("new_evidence_against") or []) if e.get("key")]
    assert keys_new, "expansion should have new evidence keys"
    for key in get_keys_by_role(keys, game_id, ["PROSECUTOR"]):
        resp = _action(key, game_id, {"type": "arg2", "evidence_key": keys_new[0], "claim": EXAMPLE_CLAIM_ARG2_PRO})
        assert resp.get("success") is True, resp
    for key in get_keys_by_role(keys, game_id, ["DEFENSE"]):
        resp = _action(key, game_id, {"type": "arg2", "evidence_key": keys_new[1] if len(keys_new) > 1 else keys_new[0], "claim": EXAMPLE_CLAIM_ARG2_DEF})
        assert resp.get("success") is True, resp

    # jury_final: 배심원 3명 verdict+reason (예시 이유문)
    state = _state(keys[0], game_id)
    assert state["phase"] == "jury_final"
    for key in get_keys_by_role(keys, game_id, ["JUROR"]):
        resp = _action(key, game_id, {"type": "jury_final", "verdict": "GUILTY", "reason": EXAMPLE_JURY_FINAL_REASON})
        assert resp.get("success") is True, resp

    final = _state(keys[0], game_id)
    assert final["gameStatus"] == "finished"
    assert final.get("phase") == "verdict" or final.get("result") is not None
    assert any(h.get("phase") == "verdict" for h in final.get("history", []))


def test_trial_invalid_then_fix_action():
    """잘못된 type 전송 후 expected_action / hint를 보고 수정해서 다시 보내는 시나리오."""
    keys = [_create_bot(f"trial_err{i}@test.com", f"ter{i}") for i in range(6)]
    game_id = _join_n_parallel(keys, "trial", 6)

    for key in keys:
        _action(key, game_id, {"type": "ready"})

    state = _state(keys[0], game_id)
    case = state.get("case", {})
    ev_for = case.get("evidence_for") or ["증거"]
    ev_against = case.get("evidence_against") or ["반증"]
    for key in get_keys_by_role(keys, game_id, ["PROSECUTOR"]):
        _action(key, game_id, {"type": "arg1", "evidence_key": ev_for[0], "claim": "주장"})
    for key in get_keys_by_role(keys, game_id, ["DEFENSE"]):
        _action(key, game_id, {"type": "arg1", "evidence_key": ev_against[0], "claim": "반박"})

    # jury_interim에서 한 배심원이 speak 전송 → 400 → jury_interim으로 수정
    state = _state(keys[0], game_id)
    assert state["phase"] == "jury_interim", state["phase"]

    juror_keys = get_keys_by_role(keys, game_id, ["JUROR"])
    assert juror_keys
    juror_key = juror_keys[0]

    bad_resp = client.post(
        f"/api/games/{game_id}/action",
        headers={"X-API-Key": juror_key},
        json={"type": "speak", "text": "wrong"},
    )
    assert bad_resp.status_code == 400
    payload = bad_resp.json()
    err = payload.get("detail") or {}
    assert err.get("success") is False
    assert err.get("expected_action") == "jury_interim"
    assert "jury_interim" in (err.get("hint") or "").lower() or "reason" in (err.get("hint") or "").lower()

    good_resp = client.post(
        f"/api/games/{game_id}/action",
        headers={"X-API-Key": juror_key},
        json={
            "type": "jury_interim",
            "verdict": "GUILTY",
            "reason": EXAMPLE_JURY_INTERIM_REASON,
            "question": EXAMPLE_JURY_INTERIM_QUESTION,
        },
    )
    assert good_resp.status_code == 200
    assert good_resp.json().get("success") is True
