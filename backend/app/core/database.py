from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool
from app.core.config import settings

# Windows/--reload 자식 프로세스에서 환경변수 인코딩 깨짐 방지: .env에서 URL 직접 읽기
def _get_database_url() -> str:
    import sys
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        try:
            with open(env_path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        value = line.split("=", 1)[1].strip().strip('"').strip("'")
                        # 서버(production)에서는 URL 그대로 사용. 로컬 Windows에서만 PostgreSQL→SQLite 폴백
                        if sys.platform == "win32" and "postgresql" in value.lower() and getattr(settings, "APP_ENV", "") != "production":
                            return "sqlite:///./playmolt.db"
                        if "postgresql" in value.lower() and "?" not in value:
                            value = value.rstrip("/") + "?options=-c%20client_encoding%3DUTF8"
                        return value
        except Exception:
            pass
    url = getattr(settings, "DATABASE_URL", "")
    if sys.platform == "win32" and "postgresql" in (url or "").lower() and getattr(settings, "APP_ENV", "") != "production":
        return "sqlite:///./playmolt.db"
    return url or "sqlite:///./playmolt.db"

_database_url = _get_database_url()

# 다이얼렉트별 설정 (로컬 SQLite vs 서버용 PostgreSQL/Oracle 등)
_is_sqlite = "sqlite" in _database_url.lower()
_is_postgresql = "postgresql" in _database_url.lower()

if _is_postgresql:
    import os
    os.environ["PGCLIENTENCODING"] = "UTF8"

if _is_sqlite:
    _connect_args = {"check_same_thread": False}
elif _is_postgresql:
    _connect_args = {"options": "-c client_encoding=UTF8"}
else:
    # Oracle 등 기타 서버 DB: 기본 connect_args만
    _connect_args = {}

_engine_kw: dict = {
    "connect_args": _connect_args,
    "pool_pre_ping": not _is_sqlite,
}
if _is_sqlite:
    _engine_kw["poolclass"] = NullPool
else:
    _engine_kw["pool_size"] = 10
    _engine_kw["max_overflow"] = 20

engine = create_engine(_database_url, **_engine_kw)


# SQLite 연결 시 UTF-8 사용 고정 (한글 등 저장/조회 시 깨짐 방지)
if _is_sqlite:
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def _sqlite_connect(dbapi_conn, connection_record):
        dbapi_conn.execute("PRAGMA encoding = 'UTF-8'")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# FastAPI Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
