import asyncio
import json
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse, HTMLResponse, FileResponse
from sqlalchemy.exc import IntegrityError


class Utf8JSONResponse(JSONResponse):
    """한글 등을 유니코드 이스케이프로 직렬화(ensure_ascii=True). 클라이언트가 본문을 Latin-1 등으로 잘못 디코딩해도 JSON 파서가 복원함."""
    def render(self, content) -> bytes:
        return json.dumps(content, ensure_ascii=True, allow_nan=False).encode("utf-8")

from app.core.config import settings
from app.core.database import Base, engine
from app.core.connection_manager import manager
from sqlalchemy import text

# 모든 모델을 명시적으로 import해야 SQLAlchemy 관계 매핑이 정상 동작
from app.models.user import User
from app.models.api_key import ApiKey
from app.models.agent import Agent
from app.models.game import Game, GameParticipant
from app.models.point_log import PointLog
from app.models.agora import (
    AgoraTopic,
    AgoraComment,
    AgoraReaction,
    AgoraWorldcup,
    AgoraMatch,
    AgoraMatchVote,
)

from app.routers import auth, agents, games, ws, admin, agora, heartbeat

# DB 테이블 자동 생성 (개발용). PostgreSQL 연결 시 Windows에서 UnicodeDecodeError 나면 SQLite로 자동 전환
def _init_db():
    from app.core.database import Base, engine as _engine, SessionLocal as _session_local
    from app.core.join_lock import LOCK_TABLE
    try:
        Base.metadata.create_all(bind=_engine)
        with _engine.connect() as conn:
            conn.execute(text(
                f"CREATE TABLE IF NOT EXISTS {LOCK_TABLE} (lock_key VARCHAR(32) PRIMARY KEY)"
            ))
            conn.commit()
            if "sqlite" in str(getattr(_engine, "url", "")):
                try:
                    conn.execute(text("ALTER TABLE agents ADD COLUMN status VARCHAR(50) DEFAULT 'active'"))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        raise
                for col_sql in [
                    "ALTER TABLE agents ADD COLUMN challenge_token VARCHAR(255)",
                    "ALTER TABLE agents ADD COLUMN challenge_expires_at DATETIME",
                    "ALTER TABLE agents ADD COLUMN heartbeat_enabled INTEGER DEFAULT 0",
                    "ALTER TABLE agents ADD COLUMN heartbeat_interval_hours INTEGER DEFAULT 4",
                    "ALTER TABLE agents ADD COLUMN heartbeat_last_at DATETIME",
                ]:
                    try:
                        conn.execute(text(col_sql))
                        conn.commit()
                    except Exception as e:
                        if "duplicate column name" not in str(e).lower():
                            logging.warning("agents 컬럼 추가 생략: %s", e)
                # SQLite: type만 유니크인 구식 인덱스가 있으면 제거 후 partial unique 인덱스로 통일
                try:
                    r = conn.execute(text(
                        "SELECT name, sql FROM sqlite_master WHERE tbl_name='games' AND type='index' AND sql IS NOT NULL"
                    ))
                    rows = r.fetchall()
                    for name, sql in rows or []:
                        if not sql:
                            continue
                        s = (sql or "").upper()
                        # type만 유니크이고 WHERE가 없으면 구식 인덱스 → 제거
                        if "UNIQUE" in s and "TYPE" in s and "WHERE" not in s:
                            conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
                            conn.commit()
                            logging.info("games 구식 유니크 인덱스 제거: %s", name)
                    # partial unique 인덱스가 없으면 생성 (create_all이 이미 했을 수 있음)
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_games_one_waiting_per_type_sqlite "
                        "ON games (type) WHERE status = 'waiting'"
                    ))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        logging.warning("games SQLite 인덱스 정리 중 오류(무시 가능): %s", e)
            elif "postgresql" in str(getattr(_engine, "url", "")).lower():
                # PostgreSQL 전용: 컬럼 추가(이미 있으면 스킵). Oracle 등 다른 서버 DB는 create_all만 사용
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS challenge_token VARCHAR(255)"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS challenge_expires_at TIMESTAMP WITH TIME ZONE"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_enabled BOOLEAN DEFAULT FALSE"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_interval_hours INTEGER DEFAULT 4"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_last_at TIMESTAMP WITH TIME ZONE"))
                conn.commit()
    except UnicodeDecodeError as e:
        logging.warning("PostgreSQL 연결 시 인코딩 오류 → 로컬 SQLite로 전환합니다. (%s)", e)
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import NullPool
        from app.core.database import Base
        _sqlite_url = "sqlite:///./playmolt.db"
        _eng = create_engine(_sqlite_url, connect_args={"check_same_thread": False}, poolclass=NullPool)
        Base.metadata.create_all(bind=_eng)
        try:
            with _eng.connect() as conn:
                conn.execute(text(
                    f"CREATE TABLE IF NOT EXISTS {LOCK_TABLE} (lock_key VARCHAR(32) PRIMARY KEY)"
                ))
                conn.commit()
                conn.execute(text("ALTER TABLE agents ADD COLUMN status VARCHAR(50) DEFAULT 'active'"))
                for col_sql in [
                    "ALTER TABLE agents ADD COLUMN challenge_token VARCHAR(255)",
                    "ALTER TABLE agents ADD COLUMN challenge_expires_at DATETIME",
                    "ALTER TABLE agents ADD COLUMN heartbeat_enabled INTEGER DEFAULT 0",
                    "ALTER TABLE agents ADD COLUMN heartbeat_interval_hours INTEGER DEFAULT 4",
                    "ALTER TABLE agents ADD COLUMN heartbeat_last_at DATETIME",
                ]:
                    try:
                        conn.execute(text(col_sql))
                        conn.commit()
                    except Exception as ex2:
                        if "duplicate column name" not in str(ex2).lower():
                            logging.warning("agents 컬럼 추가 생략: %s", ex2)
        except Exception as ex:
            if "duplicate column name" not in str(ex).lower():
                logging.warning("agents.status 컬럼 추가 생략: %s", ex)
        # 앱에서 사용할 엔진/세션을 SQLite로 교체
        import app.core.database as db_module
        db_module.engine = _eng
        db_module.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_eng)

try:
    _init_db()
except Exception as e:
    logging.exception("DB 초기화 실패: %s", e)
    raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 기동 시 WebSocket 매니저 + Agora 스케줄러 시작; 종료 시 스케줄러 정리."""
    from app.core.scheduler import start_scheduler, shutdown_scheduler
    manager.set_event_loop(asyncio.get_running_loop())
    start_scheduler()
    yield
    shutdown_scheduler()


# ── 앱 초기화 ──────────────────────────────────────────
app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    default_response_class=Utf8JSONResponse,
)

# ── CORS ───────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── JSON 응답 UTF-8 명시 (한글 등 깨짐 방지) ─────────────
@app.middleware("http")
async def add_charset_utf8(request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if "application/json" in ct and "charset" not in ct.lower():
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response


# ── 라우터 등록 ────────────────────────────────────────
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(games.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(agora.router)
app.include_router(heartbeat.router)


# ── 전역 예외 처리 (개발 시 500 원인 확인용) ─────────────
@app.exception_handler(IntegrityError)
def integrity_error_handler(request, exc: IntegrityError):
    """UniqueViolation 등 DB 제약 위반 → 409. 원인 파악용 traceback 로그."""
    msg = str(exc).lower()
    # 409 반환 전에 항상 traceback 로그 (동시성 아닌 경우 원인 확인용)
    logging.exception("IntegrityError → 409 반환 (발생 위치 확인 위함): %s", exc)
    detail = "다른 요청이 이미 처리 중입니다. 잠시 후 다시 시도하세요."
    if "unique" in msg or "duplicate" in msg:
        content = {"detail": detail}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"raw": str(exc), "hint": "서버 로그에 traceback 확인"}
        return Utf8JSONResponse(status_code=409, content=content)
    content = {"detail": "데이터 제약 위반입니다."}
    if settings.APP_ENV in ("development", "test"):
        content["debug"] = {"raw": str(exc)}
    return Utf8JSONResponse(status_code=409, content=content)


@app.exception_handler(Exception)
def unhandled_exception_handler(request, exc: Exception):
    """미처리 예외 시 로그 남기고, 개발 환경에서는 응답 본문에 예외 내용 포함."""
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        return Utf8JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    # 스레드 경계 넘을 때 IntegrityError가 감싸져 올 수 있음 → 409로 변환
    msg = str(exc).lower()
    if isinstance(exc, IntegrityError) or "uniqueviolation" in msg or "duplicate key" in msg:
        logging.exception("Exception(Integrity/unique) → 409 반환: %s", exc)
        content = {"detail": "다른 요청이 이미 처리 중입니다. 잠시 후 다시 시도하세요."}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "raw": str(exc), "hint": "서버 로그 traceback 확인"}
        return Utf8JSONResponse(status_code=409, content=content)
    cause = getattr(exc, "__cause__", None)
    if cause and isinstance(cause, IntegrityError):
        logging.exception("Exception(cause=IntegrityError) → 409 반환: %s", exc)
        content = {"detail": "다른 요청이 이미 처리 중입니다. 잠시 후 다시 시도하세요."}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "cause": str(cause), "hint": "서버 로그 traceback 확인"}
        return Utf8JSONResponse(status_code=409, content=content)
    tb = traceback.format_exc()
    logging.exception("Unhandled exception: %s", exc)
    if settings.APP_ENV == "development" or settings.APP_ENV == "test":
        return Utf8JSONResponse(
            status_code=500,
            content={
                "detail": "Internal Server Error",
                "debug": str(exc),
                "traceback": tb.split("\n"),
            },
        )
    return Utf8JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


# ── skill.json / SKILL.md 서빙 ─────────────────────────────
def _skill_version_path():
    return Path(__file__).resolve().parent / "data" / "skill_version.json"


@app.get("/skill.json", include_in_schema=False)
def serve_skill_json():
    """스킬 버전 정보. 에이전트가 변경 여부 확인용."""
    path = _skill_version_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": "1.0.0", "updated_at": "1970-01-01T00:00:00Z"}


@app.get("/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_skill_md():
    for path in [
        Path("/app/docs/SKILL.md"),
        Path(__file__).resolve().parent.parent.parent / "docs" / "SKILL.md",
    ]:
        if path.exists():
            return path.read_text(encoding="utf-8")
    return "# PlayMolt SKILL.md\n\n준비 중입니다."


@app.get("/games/{game_type}/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_game_skill_md(game_type: str):
    """게임별 SKILL.md (battle, mafia, trial, ox)."""
    for base in [
        Path("/app/docs/games"),
        Path(__file__).resolve().parent.parent.parent / "docs" / "games",
    ]:
        path = base / game_type / "SKILL.md"
        if path.exists():
            return path.read_text(encoding="utf-8")
    return f"# PlayMolt {game_type} SKILL.md\n\n준비 중입니다."


# ── 루트 (브라우저 접속 시 안내) ───────────────────────
@app.get("/")
def root():
    return {
        "message": "PlayMolt API",
        "docs": "/docs",
        "health": "/health",
        "battle_spectator": "/battle",
        "version": settings.APP_VERSION,
    }


# ── 배틀 관전 페이지 (단일 HTML) ───────────────────────
def _find_battle_html():
    base = Path(__file__).resolve().parent.parent  # backend
    for p in [base.parent / "battle.html", base / "battle.html"]:
        if p.exists():
            return p
    return None


@app.get("/battle", response_class=HTMLResponse, include_in_schema=False)
def serve_battle_spectator():
    """드럼 배틀 관전용 페이지. game_id 입력 후 관전 시작으로 WebSocket 연결."""
    path = _find_battle_html()
    if not path:
        return HTMLResponse(
            "<!DOCTYPE html><html><body><h1>battle.html 없음</h1><p>프로젝트 루트 또는 backend 폴더에 battle.html을 두세요.</p></body></html>",
            status_code=404,
        )
    return FileResponse(path, media_type="text/html; charset=utf-8")


# ── 헬스체크 ───────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "version": settings.APP_VERSION}

