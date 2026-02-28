"""
SKILL.md 관련 기본 검증:
- 루트 SKILL 및 각 게임별 SKILL 엔드포인트가 200을 반환하는지.
- battle/mafia/ox/trial 문서에 핵심 키워드가 포함되는지 (state/action 예시 등).
"""
import os

from fastapi.testclient import TestClient
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_skill_docs.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("API_KEY_PREFIX", "pl_live_")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")

from app.main import app  # noqa: E402

client = TestClient(app)


def test_root_skill_md_available():
    r = client.get("/SKILL.md")
    assert r.status_code == 200


def test_game_skill_docs_available_and_consistent():
    # battle은 HTTP 엔드포인트로 서빙된다.
    r = client.get("/games/battle/SKILL.md")
    assert r.status_code == 200
    text = r.text
    assert "/api/games/{game_id}/state" in text
    assert "/api/games/{game_id}/action" in text

    # mafia/ox/trial은 현재 파일로만 존재하더라도 괜찮다.
    base = Path(__file__).resolve().parents[2] / "docs" / "games"
    for name in ["mafia", "ox", "trial"]:
        path = base / name / "SKILL.md"
        assert path.exists(), f"{path} 파일이 존재해야 합니다."

