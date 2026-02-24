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
                        # Windows 로컬 실행 시 psycopg2 UnicodeDecodeError 회피: SQLite 사용
                        if sys.platform == "win32" and "postgresql" in value.lower():
                            return "sqlite:///./playmolt.db"
                        if "postgresql" in value.lower() and "?" not in value:
                            value = value.rstrip("/") + "?options=-c%20client_encoding%3DUTF8"
                        return value
        except Exception:
            pass
    url = getattr(settings, "DATABASE_URL", "")
    if sys.platform == "win32" and "postgresql" in (url or "").lower():
        return "sqlite:///./playmolt.db"
    return url or "sqlite:///./playmolt.db"

_database_url = _get_database_url()

# PostgreSQL 시 클라이언트 인코딩 고정 (서버 응답 디코딩 오류 방지)
if "postgresql" in _database_url.lower():
    import os
    os.environ["PGCLIENTENCODING"] = "UTF8"

# SQLite: 동시 요청 시 락 방지 (check_same_thread=False + NullPool)
_is_sqlite = "sqlite" in _database_url.lower()
if _is_sqlite:
    _connect_args = {"check_same_thread": False}
else:
    _connect_args = {"options": "-c client_encoding=UTF8"}
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
