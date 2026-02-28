"""
join_lock: 게임 타입별 join 직렬화.
- DB 락 테이블(game_join_locks)로 SQLite/PostgreSQL 공통 직렬화 → 멀티워커여도 방이 갈라지지 않음.
- acquire_join_lock / release_join_lock 을 join 전후에 호출.
"""
import logging
import threading
import time
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

LOCK_TABLE = "game_join_locks"
MAX_ACQUIRE_ATTEMPTS = 60
ACQUIRE_DELAY = 0.25
# 이 시간 넘게 락 잡혀 있으면 선행 요청이 죽은 것으로 보고 강제 해제
STALE_LOCK_SEC = 12

# SQLite용: 프로세스 내 스레드 락
_thread_locks: dict[str, threading.Lock] = {}
_thread_locks_mutex = threading.Lock()


def get_join_lock_for_type(game_type: str) -> threading.Lock:
    """SQLite 단일 프로세스에서 사용. 게임 타입별 스레드 락."""
    with _thread_locks_mutex:
        if game_type not in _thread_locks:
            _thread_locks[game_type] = threading.Lock()
        return _thread_locks[game_type]


def _ensure_table(db: Session) -> None:
    """SQLite/PostgreSQL 공통: 락 테이블 없으면 생성."""
    db.execute(text(
        f"CREATE TABLE IF NOT EXISTS {LOCK_TABLE} (lock_key VARCHAR(32) PRIMARY KEY)"
    ))
    db.commit()


def acquire_join_lock(db: Session, game_type: str) -> None:
    """DB 한 행으로 join 직렬화 (SQLite/PostgreSQL 공통, 멀티워커에서도 방 하나만 쓰도록)."""
    acquire_lock(db, f"join_{game_type}")


def release_join_lock(db: Session, game_type: str) -> None:
    """DB 락 해제 (SQLite/PostgreSQL 공통)."""
    release_lock(db, f"join_{game_type}")


def acquire_lock(db: Session, lock_key: str) -> None:
    """임의 키로 DB 행 락 획득 (Oracle 등 서버 DB에서 게임 생성 직렬화용)."""
    _ensure_table(db)
    start = time.monotonic()
    for attempt in range(MAX_ACQUIRE_ATTEMPTS):
        try:
            db.execute(
                text(f"INSERT INTO {LOCK_TABLE} (lock_key) VALUES (:key)"),
                {"key": lock_key}
            )
            db.commit()
            return
        except IntegrityError:
            db.rollback()
            if time.monotonic() - start >= STALE_LOCK_SEC:
                try:
                    db.execute(
                        text(f"DELETE FROM {LOCK_TABLE} WHERE lock_key = :key"),
                        {"key": lock_key}
                    )
                    db.commit()
                    logging.warning("lock 강제 해제(오래 잡힘) key=%s", lock_key)
                    start = time.monotonic()
                except Exception as e:
                    db.rollback()
                    logging.warning("lock 강제 해제 실패: %s", e)
            if attempt == MAX_ACQUIRE_ATTEMPTS - 1:
                raise
            time.sleep(ACQUIRE_DELAY)


def release_lock(db: Session, lock_key: str) -> None:
    """임의 키로 DB 락 해제."""
    try:
        db.execute(
            text(f"DELETE FROM {LOCK_TABLE} WHERE lock_key = :key"),
            {"key": lock_key}
        )
        db.commit()
    except Exception as e:
        db.rollback()
        logging.warning("lock release error key=%s: %s", lock_key, e)
