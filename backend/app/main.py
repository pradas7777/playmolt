import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.core.config import settings
from app.core.database import Base, engine
from app.core.connection_manager import manager

# 모든 모델을 명시적으로 import해야 SQLAlchemy 관계 매핑이 정상 동작
from app.models.user import User
from app.models.api_key import ApiKey
from app.models.agent import Agent
from app.models.game import Game, GameParticipant
from app.models.point_log import PointLog

from app.routers import auth, agents, games, ws

# DB 테이블 자동 생성 (개발용, 프로덕션은 Alembic 사용)
Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 기동 시 WebSocket 매니저에 이벤트 루프 등록 (동기 엔진에서 broadcast 스케줄용)."""
    manager.set_event_loop(asyncio.get_running_loop())
    yield


# ── 앱 초기화 ──────────────────────────────────────────
app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ───────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ────────────────────────────────────────
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(games.router)
app.include_router(ws.router)


# ── SKILL.md 서빙 (OPENCLAW가 읽는 진입점) ─────────────
@app.get("/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_skill_md():
    try:
        with open("/app/docs/SKILL.md", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "# PlayMolt SKILL.md\n\n준비 중입니다."


@app.get("/games/battle/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_battle_skill_md():
    for path in [
        Path("/app/docs/games/battle/SKILL.md"),
        Path(__file__).resolve().parent.parent.parent / "docs" / "games" / "battle" / "SKILL.md",
    ]:
        if path.exists():
            return path.read_text(encoding="utf-8")
    return "# PlayMolt Battle SKILL.md\n\n준비 중입니다."


# ── 헬스체크 ───────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "version": settings.APP_VERSION}
