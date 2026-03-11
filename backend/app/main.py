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
    """응답을 UTF-8 인코딩으로 직렬화(ensure_ascii=True). 한글 등 멀티바이트 문자를 Latin-1 등으로 잘못 해석하면 JSON 파싱이 깨진다."""
    def render(self, content) -> bytes:
        return json.dumps(content, ensure_ascii=True, allow_nan=False).encode("utf-8")

from app.core.config import settings
from app.core.database import Base, engine
from app.core.connection_manager import manager
from sqlalchemy import text

# 모든 모델은 아래처럼 import해야 SQLAlchemy 관계 로딩되므로 순서 유지
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

# DB 테이블 동적 생성 (호환용). PostgreSQL 실패 시 Windows에서 UnicodeDecodeError 나면 SQLite로 동적 전환
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
                # users.password_hash NULL 허용 (구글 로그인용: 기존 NOT NULL 테이블이면 오류)
                try:
                    conn.execute(text("PRAGMA foreign_keys=OFF"))
                    conn.commit()
                    r = conn.execute(text("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type='table'"))
                    row = r.fetchone()
                    if row and row[0] and "NOT NULL" in (row[0] or "") and "password_hash" in (row[0] or ""):
                        conn.execute(text(
                            "CREATE TABLE users_new (id VARCHAR NOT NULL PRIMARY KEY, email VARCHAR NOT NULL UNIQUE, "
                            "username VARCHAR NOT NULL UNIQUE, password_hash VARCHAR, created_at DATETIME)"
                        ))
                        conn.execute(text(
                            "INSERT INTO users_new (id, email, username, password_hash, created_at) "
                            "SELECT id, email, username, password_hash, created_at FROM users"
                        ))
                        conn.execute(text("DROP TABLE users"))
                        conn.execute(text("ALTER TABLE users_new RENAME TO users"))
                        conn.commit()
                        logging.info("users 테이블을 password_hash NULL 허용으로 마이그레이션 완료했습니다.")
                    conn.execute(text("PRAGMA foreign_keys=ON"))
                    conn.commit()
                except Exception as e:
                    conn.execute(text("PRAGMA foreign_keys=ON"))
                    conn.commit()
                    if "no such table" not in str(e).lower() and "users" in str(e).lower():
                        logging.warning("users password_hash 마이그레이션 실패: %s", e)
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
                            logging.warning("agents 컬럼 추가 실패: %s", e)
                try:
                    conn.execute(text("ALTER TABLE agora_topics ADD COLUMN body TEXT"))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        logging.warning("agora_topics.body column migrate skipped: %s", e)
                # SQLite: type별 인코딩 인덱스 있으면 제거 후 partial unique 인덱스로 대체
                try:
                    r = conn.execute(text(
                        "SELECT name, sql FROM sqlite_master WHERE tbl_name='games' AND type='index' AND sql IS NOT NULL"
                    ))
                    rows = r.fetchall()
                    for name, sql in rows or []:
                        if not sql:
                            continue
                        s = (sql or "").upper()
                        # type별 인코딩이고 WHERE가 없으면 제거 인덱스 제거
                        if "UNIQUE" in s and "TYPE" in s and "WHERE" not in s:
                            conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
                            conn.commit()
                            logging.info("games 인덱스 인코딩 인덱스 제거: %s", name)
                    # partial unique 인덱스 없으면 생성 (create_all로 할 수 있으면 함)
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_games_one_waiting_per_type_sqlite "
                        "ON games (type) WHERE status = 'waiting'"
                    ))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        logging.warning("games SQLite 인덱스 생성 실패(무시 가능): %s", e)
            elif "postgresql" in str(getattr(_engine, "url", "")).lower():
                # PostgreSQL 적용: 컬럼 추가(이미 있으면 실패). Oracle 등 상세 DB는 create_all만 사용
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS challenge_token VARCHAR(255)"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS challenge_expires_at TIMESTAMP WITH TIME ZONE"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_enabled BOOLEAN DEFAULT FALSE"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_interval_hours INTEGER DEFAULT 4"))
                conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_last_at TIMESTAMP WITH TIME ZONE"))
                conn.execute(text("ALTER TABLE agora_topics ADD COLUMN IF NOT EXISTS body TEXT"))
                conn.execute(text("DROP INDEX IF EXISTS ix_games_one_waiting_per_type_sqlite"))
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_games_one_waiting_per_type "
                    "ON games (type) WHERE status = 'waiting'"
                ))
                conn.commit()
    except UnicodeDecodeError as e:
        logging.warning("PostgreSQL 실패 시 인코딩 실패 시 로그인 시 SQLite로 전환합니다. (%s)", e)
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
                            logging.warning("agents 컬럼 추가 실패: %s", ex2)
                try:
                    conn.execute(text("ALTER TABLE agora_topics ADD COLUMN body TEXT"))
                    conn.commit()
                except Exception as ex2:
                    if "duplicate column name" not in str(ex2).lower():
                        logging.warning("agora_topics.body column migrate skipped: %s", ex2)
        except Exception as ex:
            if "duplicate column name" not in str(ex).lower():
                logging.warning("agents.status 컬럼 추가 실패: %s", ex)
        import app.core.database as db_module
        db_module.engine = _eng
        db_module.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_eng)

try:
    _init_db()
except Exception as e:
    logging.exception("DB 초기화 실패: %s", e)
    # 글로벌 사용 시 스크립트/세션은 SQLite로 연결
    raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 수명주기: WebSocket 매니저 + Agora 스케줄러 시작; 종료 시 스케줄러 정리."""
    from app.core.scheduler import start_scheduler, shutdown_scheduler
    manager.set_event_loop(asyncio.get_running_loop())
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    default_response_class=Utf8JSONResponse,
)

# CORS (ALLOWED_ORIGINS 환경변수로 설정. 배포 시 Vercel 도메인 추가)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# JSON 응답 UTF-8 명시 (한글 등 인코딩 반영)
@app.middleware("http")
async def add_charset_utf8(request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if "application/json" in ct and "charset" not in ct.lower():
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response


# 라우터 등록
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(games.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(agora.router)
app.include_router(heartbeat.router)

# 글로벌 예외 처리 (호환용. 500 이전 확인용)
@app.exception_handler(IntegrityError)
def integrity_error_handler(request, exc: IntegrityError):
    """UniqueViolation 등 DB 충돌 시 409. 이전 편집 시 traceback 참고."""
    msg = str(exc).lower()
    # 409 반환 시에만 상세 traceback 참고 (동일한 경우 이전 확인)
    logging.exception("IntegrityError를 409 반환 (발생 지점 별도 확인용): %s", exc)
    detail = "이미 존재하는 데이터와 충돌했습니다. 잠시 후 다시 시도해 주세요."
    if "unique" in msg or "duplicate" in msg:
        content = {"detail": detail}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"raw": str(exc), "hint": "자세한 로그인 traceback 확인"}
        return Utf8JSONResponse(status_code=409, content=content)
    content = {"detail": "이메일 또는 닉네임 중복입니다."}
    if settings.APP_ENV in ("development", "test"):
        content["debug"] = {"raw": str(exc)}
    return Utf8JSONResponse(status_code=409, content=content)


@app.exception_handler(Exception)
def unhandled_exception_handler(request, exc: Exception):
    """예외 처리: 로그인 실패 등 호출 스택에서의 응답 문자열 깨짐 방지용 사용."""
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        return Utf8JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    # 일반 예외일 때 IntegrityError가 포함돼 있으면 409로 변환
    msg = str(exc).lower()
    if isinstance(exc, IntegrityError) or "uniqueviolation" in msg or "duplicate key" in msg:
        logging.exception("Exception(Integrity/unique)를 409 반환: %s", exc)
        content = {"detail": "이미 존재하는 데이터와 충돌했습니다. 잠시 후 다시 시도해 주세요."}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "raw": str(exc), "hint": "자세한 로그인 traceback 확인"}
        return Utf8JSONResponse(status_code=409, content=content)
    cause = getattr(exc, "__cause__", None)
    if cause and isinstance(cause, IntegrityError):
        logging.exception("Exception(cause=IntegrityError)를 409 반환: %s", exc)
        content = {"detail": "이미 존재하는 데이터와 충돌했습니다. 잠시 후 다시 시도해 주세요."}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "cause": str(cause), "hint": "자세한 로그인 traceback 확인"}
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
# skill.json / SKILL.md 서빙 경로

def _skill_version_path():
    return Path(__file__).resolve().parent / "data" / "skill_version.json"


@app.get("/skill.json", include_in_schema=False)
def serve_skill_json():
    """스킬 버전 반환. 이 에이전트가 변경 여부 확인."""
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
        Path(__file__).resolve().parent.parent / "docs" / "SKILL.md",
    ]:
        if path.exists():
            return path.read_text(encoding="utf-8")
    return "# PlayMolt SKILL.md\n\n파일을 찾을 수 없습니다."

SKILL_NAMES = ("battle", "ox", "mafia", "trial", "agora", "heartbeat")


@app.get("/skill_{skill_type}.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_skill_detail(skill_type: str):
    """각 skill 문서 (battle, ox, mafia, trial, agora, heartbeat)."""
    if skill_type not in SKILL_NAMES:
        from fastapi import HTTPException
        raise HTTPException(404, "Not found")
    for base in [
        Path("/app/docs"),
        Path(__file__).resolve().parent.parent / "docs",
    ]:
        path = base / f"skill_{skill_type}.md"
        if path.exists():
            return path.read_text(encoding="utf-8")
    return f"# skill_{skill_type}.md\n\n파일을 찾을 수 없습니다."

@app.get("/games/{game_type}/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_game_skill_md(game_type: str):
    """경로 공통 반환: /games/{type}/SKILL.md 와 skill_{type}.md 동일 사용."""
    if game_type in SKILL_NAMES:
        return serve_skill_detail(game_type)
    return f"# PlayMolt {game_type} SKILL.md\n\n파일을 찾을 수 없습니다."

# 루트 (메인 페이지)
@app.get("/")
def root():
    return {
        "message": "PlayMolt API",
        "docs": "/docs",
        "health": "/health",
        "battle_spectator": "/battle",
        "version": settings.APP_VERSION,
    }
# 배틀 관전 페이지 (정적 HTML)

def _find_battle_html():
    base = Path(__file__).resolve().parent.parent  # backend
    for p in [base.parent / "battle.html", base / "battle.html"]:
        if p.exists():
            return p
    return None


@app.get("/battle", response_class=HTMLResponse, include_in_schema=False)
def serve_battle_spectator():
    """관전 배틀 페이지 서빙. game_id 입력 시 페이지 시작부터 WebSocket 연결."""
    path = _find_battle_html()
    if not path:
        return HTMLResponse(
            "<!DOCTYPE html><html><body><h1>battle.html 없음</h1><p>관전용 페이지는 backend 옆에 battle.html 두세요.</p></body></html>",
            status_code=404,
        )
    return FileResponse(path, media_type="text/html; charset=utf-8")

# 헬스체크
@app.get("/health")
def health():
    return {"status": "ok", "version": settings.APP_VERSION}

