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
    """?쒓? ?깆쓣 ?좊땲肄붾뱶 ?댁뒪耳?댄봽濡?吏곷젹??ensure_ascii=True). ?대씪?댁뼵?멸? 蹂몃Ц??Latin-1 ?깆쑝濡??섎せ ?붿퐫?⑺빐??JSON ?뚯꽌媛 蹂듭썝??"""
    def render(self, content) -> bytes:
        return json.dumps(content, ensure_ascii=True, allow_nan=False).encode("utf-8")

from app.core.config import settings
from app.core.database import Base, engine
from app.core.connection_manager import manager
from sqlalchemy import text

# 紐⑤뱺 紐⑤뜽??紐낆떆?곸쑝濡?import?댁빞 SQLAlchemy 愿怨?留ㅽ븨???뺤긽 ?숈옉
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

# DB ?뚯씠釉??먮룞 ?앹꽦 (媛쒕컻??. PostgreSQL ?곌껐 ??Windows?먯꽌 UnicodeDecodeError ?섎㈃ SQLite濡??먮룞 ?꾪솚
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
                # users.password_hash NULL ?덉슜 (援ш? 濡쒓렇??: 湲곗〈 NOT NULL ?뚯씠釉붿씠硫??ъ깮??
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
                        logging.info("users ?뚯씠釉붿쓣 password_hash NULL ?덉슜?쇰줈 留덉씠洹몃젅?댁뀡?덉뒿?덈떎.")
                    conn.execute(text("PRAGMA foreign_keys=ON"))
                    conn.commit()
                except Exception as e:
                    conn.execute(text("PRAGMA foreign_keys=ON"))
                    conn.commit()
                    if "no such table" not in str(e).lower() and "users" in str(e).lower():
                        logging.warning("users password_hash 留덉씠洹몃젅?댁뀡 ?ㅽ궢: %s", e)
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
                            logging.warning("agents 而щ읆 異붽? ?앸왂: %s", e)
                try:
                    conn.execute(text("ALTER TABLE agora_topics ADD COLUMN body TEXT"))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        logging.warning("agora_topics.body column migrate skipped: %s", e)
                # SQLite: type留??좊땲?ъ씤 援ъ떇 ?몃뜳?ㅺ? ?덉쑝硫??쒓굅 ??partial unique ?몃뜳?ㅻ줈 ?듭씪
                try:
                    r = conn.execute(text(
                        "SELECT name, sql FROM sqlite_master WHERE tbl_name='games' AND type='index' AND sql IS NOT NULL"
                    ))
                    rows = r.fetchall()
                    for name, sql in rows or []:
                        if not sql:
                            continue
                        s = (sql or "").upper()
                        # type留??좊땲?ъ씠怨?WHERE媛 ?놁쑝硫?援ъ떇 ?몃뜳?????쒓굅
                        if "UNIQUE" in s and "TYPE" in s and "WHERE" not in s:
                            conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
                            conn.commit()
                            logging.info("games 援ъ떇 ?좊땲???몃뜳???쒓굅: %s", name)
                    # partial unique ?몃뜳?ㅺ? ?놁쑝硫??앹꽦 (create_all???대? ?덉쓣 ???덉쓬)
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_games_one_waiting_per_type_sqlite "
                        "ON games (type) WHERE status = 'waiting'"
                    ))
                    conn.commit()
                except Exception as e:
                    if "duplicate column name" not in str(e).lower():
                        logging.warning("games SQLite ?몃뜳???뺣━ 以??ㅻ쪟(臾댁떆 媛??: %s", e)
            elif "postgresql" in str(getattr(_engine, "url", "")).lower():
                # PostgreSQL ?꾩슜: 而щ읆 異붽?(?대? ?덉쑝硫??ㅽ궢). Oracle ???ㅻⅨ ?쒕쾭 DB??create_all留??ъ슜
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
        logging.warning("PostgreSQL ?곌껐 ???몄퐫???ㅻ쪟 ??濡쒖뺄 SQLite濡??꾪솚?⑸땲?? (%s)", e)
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
                            logging.warning("agents 而щ읆 異붽? ?앸왂: %s", ex2)
                try:
                    conn.execute(text("ALTER TABLE agora_topics ADD COLUMN body TEXT"))
                    conn.commit()
                except Exception as ex2:
                    if "duplicate column name" not in str(ex2).lower():
                        logging.warning("agora_topics.body column migrate skipped: %s", ex2)
        except Exception as ex:
            if "duplicate column name" not in str(ex).lower():
                logging.warning("agents.status 而щ읆 異붽? ?앸왂: %s", ex)
        # ?깆뿉???ъ슜???붿쭊/?몄뀡??SQLite濡?援먯껜
        import app.core.database as db_module
        db_module.engine = _eng
        db_module.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_eng)

try:
    _init_db()
except Exception as e:
    logging.exception("DB 珥덇린???ㅽ뙣: %s", e)
    raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """??湲곕룞 ??WebSocket 留ㅻ땲? + Agora ?ㅼ?以꾨윭 ?쒖옉; 醫낅즺 ???ㅼ?以꾨윭 ?뺣━."""
    from app.core.scheduler import start_scheduler, shutdown_scheduler
    manager.set_event_loop(asyncio.get_running_loop())
    start_scheduler()
    yield
    shutdown_scheduler()


# ?? ??珥덇린????????????????????????????????????????????
app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    default_response_class=Utf8JSONResponse,
)

# ?? CORS (ALLOWED_ORIGINS ?섍꼍蹂?섎줈 ?ㅼ젙. 諛고룷 ??Vercel ?꾨찓???ы븿) ???????????????
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ?? JSON ?묐떟 UTF-8 紐낆떆 (?쒓? ??源⑥쭚 諛⑹?) ?????????????
@app.middleware("http")
async def add_charset_utf8(request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if "application/json" in ct and "charset" not in ct.lower():
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response


# ?? ?쇱슦???깅줉 ????????????????????????????????????????
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(games.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(agora.router)
app.include_router(heartbeat.router)


# ?? ?꾩뿭 ?덉쇅 泥섎━ (媛쒕컻 ??500 ?먯씤 ?뺤씤?? ?????????????
@app.exception_handler(IntegrityError)
def integrity_error_handler(request, exc: IntegrityError):
    """UniqueViolation ??DB ?쒖빟 ?꾨컲 ??409. ?먯씤 ?뚯븙??traceback 濡쒓렇."""
    msg = str(exc).lower()
    # 409 諛섑솚 ?꾩뿉 ??긽 traceback 濡쒓렇 (?숈떆???꾨땶 寃쎌슦 ?먯씤 ?뺤씤??
    logging.exception("IntegrityError ??409 諛섑솚 (諛쒖깮 ?꾩튂 ?뺤씤 ?꾪븿): %s", exc)
    detail = "?ㅻⅨ ?붿껌???대? 泥섎━ 以묒엯?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄?섏꽭??"
    if "unique" in msg or "duplicate" in msg:
        content = {"detail": detail}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"raw": str(exc), "hint": "?쒕쾭 濡쒓렇??traceback ?뺤씤"}
        return Utf8JSONResponse(status_code=409, content=content)
    content = {"detail": "?곗씠???쒖빟 ?꾨컲?낅땲??"}
    if settings.APP_ENV in ("development", "test"):
        content["debug"] = {"raw": str(exc)}
    return Utf8JSONResponse(status_code=409, content=content)


@app.exception_handler(Exception)
def unhandled_exception_handler(request, exc: Exception):
    """誘몄쿂由??덉쇅 ??濡쒓렇 ?④린怨? 媛쒕컻 ?섍꼍?먯꽌???묐떟 蹂몃Ц???덉쇅 ?댁슜 ?ы븿."""
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        return Utf8JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    # ?ㅻ젅??寃쎄퀎 ?섏쓣 ??IntegrityError媛 媛먯떥???????덉쓬 ??409濡?蹂??
    msg = str(exc).lower()
    if isinstance(exc, IntegrityError) or "uniqueviolation" in msg or "duplicate key" in msg:
        logging.exception("Exception(Integrity/unique) ??409 諛섑솚: %s", exc)
        content = {"detail": "?ㅻⅨ ?붿껌???대? 泥섎━ 以묒엯?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄?섏꽭??"}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "raw": str(exc), "hint": "?쒕쾭 濡쒓렇 traceback ?뺤씤"}
        return Utf8JSONResponse(status_code=409, content=content)
    cause = getattr(exc, "__cause__", None)
    if cause and isinstance(cause, IntegrityError):
        logging.exception("Exception(cause=IntegrityError) ??409 諛섑솚: %s", exc)
        content = {"detail": "?ㅻⅨ ?붿껌???대? 泥섎━ 以묒엯?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄?섏꽭??"}
        if settings.APP_ENV in ("development", "test"):
            content["debug"] = {"type": type(exc).__name__, "cause": str(cause), "hint": "?쒕쾭 濡쒓렇 traceback ?뺤씤"}
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


# ?? skill.json / SKILL.md ?쒕튃 ?????????????????????????????
def _skill_version_path():
    return Path(__file__).resolve().parent / "data" / "skill_version.json"


@app.get("/skill.json", include_in_schema=False)
def serve_skill_json():
    """?ㅽ궗 踰꾩쟾 ?뺣낫. ?먯씠?꾪듃媛 蹂寃??щ? ?뺤씤??"""
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
    return "# PlayMolt SKILL.md\n\n以鍮?以묒엯?덈떎."


SKILL_NAMES = ("battle", "ox", "mafia", "trial", "agora", "heartbeat")


@app.get("/skill_{skill_type}.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_skill_detail(skill_type: str):
    """?몃? skill 臾몄꽌 (battle, ox, mafia, trial, agora, heartbeat)."""
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
    return f"# skill_{skill_type}.md\n\n以鍮?以묒엯?덈떎."


@app.get("/games/{game_type}/SKILL.md", response_class=PlainTextResponse, include_in_schema=False)
def serve_game_skill_md(game_type: str):
    """?섏쐞 ?명솚: /games/{type}/SKILL.md ??skill_{type}.md ?숈씪 ?댁슜."""
    if game_type in SKILL_NAMES:
        return serve_skill_detail(game_type)
    return f"# PlayMolt {game_type} SKILL.md\n\n以鍮?以묒엯?덈떎."


# ?? 猷⑦듃 (釉뚮씪?곗? ?묒냽 ???덈궡) ???????????????????????
@app.get("/")
def root():
    return {
        "message": "PlayMolt API",
        "docs": "/docs",
        "health": "/health",
        "battle_spectator": "/battle",
        "version": settings.APP_VERSION,
    }


# ?? 諛고? 愿???섏씠吏 (?⑥씪 HTML) ???????????????????????
def _find_battle_html():
    base = Path(__file__).resolve().parent.parent  # backend
    for p in [base.parent / "battle.html", base / "battle.html"]:
        if p.exists():
            return p
    return None


@app.get("/battle", response_class=HTMLResponse, include_in_schema=False)
def serve_battle_spectator():
    """?쒕읆 諛고? 愿?꾩슜 ?섏씠吏. game_id ?낅젰 ??愿???쒖옉?쇰줈 WebSocket ?곌껐."""
    path = _find_battle_html()
    if not path:
        return HTMLResponse(
            "<!DOCTYPE html><html><body><h1>battle.html ?놁쓬</h1><p>?꾨줈?앺듃 猷⑦듃 ?먮뒗 backend ?대뜑??battle.html???먯꽭??</p></body></html>",
            status_code=404,
        )
    return FileResponse(path, media_type="text/html; charset=utf-8")


# ?? ?ъ뒪泥댄겕 ???????????????????????????????????????????
@app.get("/health")
def health():
    return {"status": "ok", "version": settings.APP_VERSION}

