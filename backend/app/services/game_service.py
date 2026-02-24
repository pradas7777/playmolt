"""
services/game_service.py
게임 자동 배정 서비스.
대기 중인 방이 있으면 배정, 없으면 새로 생성.
동시 join 시: PostgreSQL은 advisory lock으로 프로세스 간 직렬화, Unique 위반 시 재조회.
"""
import logging
import threading
import time
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.game import Game, GameType, GameStatus

# SQLite(단일 프로세스)에서 대기 중인 게임 없을 때 직렬화용
_creation_locks: dict[GameType, threading.Lock] = {}
_creation_locks_mutex = threading.Lock()


def _get_creation_lock(gtype: GameType) -> threading.Lock:
    with _creation_locks_mutex:
        if gtype not in _creation_locks:
            _creation_locks[gtype] = threading.Lock()
        return _creation_locks[gtype]


def _is_unique_violation(exc: BaseException) -> bool:
    """UniqueViolation / duplicate key 여부 확인 (다른 래퍼로 올 수 있음)."""
    msg = str(exc).lower()
    return "uniqueviolation" in msg or "duplicate key" in msg or "unique constraint" in msg


def _find_existing_and_return(gtype: GameType, db: Session, retries: int = 5, delay: float = 0.08) -> Game | None:
    """대기 중인 방 조회. 동시 생성 시 다른 프로세스 커밋이 늦게 보일 수 있어 재시도."""
    for _ in range(retries):
        existing = (
            db.query(Game)
            .filter(
                Game.type == gtype,
                Game.status == GameStatus.waiting,
            )
            .first()
        )
        if existing:
            return existing
        time.sleep(delay)
    return None


def _find_waiting_game_fresh_session(gtype: GameType, db: Session) -> Game | None:
    """다른 연결(세션)으로 대기 방 조회. 현재 세션에서 커밋된 행이 안 보일 때 사용."""
    from app.core.database import SessionLocal
    fresh = SessionLocal()
    try:
        existing = (
            fresh.query(Game)
            .filter(
                Game.type == gtype,
                Game.status == GameStatus.waiting,
            )
            .first()
        )
        if not existing:
            return None
        # 현재 세션에서 같은 id로 다시 로드해 반환
        return db.query(Game).filter(Game.id == existing.id).first()
    finally:
        fresh.close()


def get_or_create_game(game_type: str, db: Session) -> Game:
    """
    대기 중인 방 자동 배정. 없으면 새 방 생성.
    - PostgreSQL: advisory lock으로 워커 간 직렬화 + Unique 위반 시 재조회
    - SQLite: 스레드 락 + Unique 위반 시 재조회
    """
    try:
        gtype = GameType(game_type)
    except ValueError:
        raise ValueError(f"지원하지 않는 게임 타입: {game_type}")

    config = _default_config(gtype)
    dialect_name = db.get_bind().dialect.name

    def do_create() -> Game:
        # PostgreSQL: 프로세스/워커 구분 없이 한 번에 한 연결만 생성 구간 진입
        if dialect_name == "postgresql":
            key = hash(gtype.value) % (2**31)
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

        # SQLite는 단일 프로세스 가정, 스레드 락만 사용
        if dialect_name == "sqlite":
            with _get_creation_lock(gtype):
                return _get_or_create_inside(gtype, config, db)
        return _get_or_create_inside(gtype, config, db)

    return do_create()


def _get_or_create_inside(gtype: GameType, config: dict, db: Session) -> Game:
    """실제 조회/생성 (advisory lock 또는 스레드 락 안에서 호출)."""
    # 다른 워커가 방금 만든 방을 먼저 확인 (현재 세션은 아직 못 볼 수 있음)
    existing = _find_waiting_game_fresh_session(gtype, db)
    if existing:
        return existing
    existing = _find_existing_and_return(gtype, db)
    if existing:
        return existing
    time.sleep(0.05)
    existing = _find_existing_and_return(gtype, db, retries=3, delay=0.05)
    if existing:
        return existing
    existing = _find_waiting_game_fresh_session(gtype, db)
    if existing:
        return existing

    try:
        game = Game(
            type=gtype,
            status=GameStatus.waiting,
            config=config,
        )
        db.add(game)
        db.commit()
        db.refresh(game)
        return game
    except IntegrityError:
        # 동시 생성 시 UniqueViolation → 이미 커밋된 대기 방 재조회 (재시도 포함)
        db.rollback()
        db.expire_all()  # 세션 캐시 비우고 DB에서 다시 읽기
        existing = _find_existing_and_return(gtype, db)
        if existing:
            return existing
        # 다른 세션(연결)으로 조회 — 같은 요청/트랜잭션에서 커밋된 행이 안 보일 수 있음
        existing = _find_waiting_game_fresh_session(gtype, db)
        if existing:
            return existing
        # 원인 파악: 대기 방이 전혀 없는지, 해당 타입 게임이 이미 있는지
        any_waiting = db.query(Game).filter(Game.status == GameStatus.waiting).count()
        any_of_type = db.query(Game).filter(Game.type == gtype).first()
        if any_of_type:
            logging.warning(
                "get_or_create_game IntegrityError 후 대기 방 없음 gtype=%s (기존 게임 id=%s status=%s, 전체 대기 방 수=%s)",
                gtype, any_of_type.id, any_of_type.status, any_waiting,
            )
        else:
            logging.warning(
                "get_or_create_game IntegrityError 후 대기 방 재조회 실패 gtype=%s (전체 대기 방 수=%s)",
                gtype, any_waiting,
            )
        raise
    except Exception as e:
        db.rollback()
        db.expire_all()
        if _is_unique_violation(e):
            existing = _find_existing_and_return(gtype, db)
            if existing:
                return existing
            existing = _find_waiting_game_fresh_session(gtype, db)
            if existing:
                return existing
            any_waiting = db.query(Game).filter(Game.status == GameStatus.waiting).count()
            any_of_type = db.query(Game).filter(Game.type == gtype).first()
            if any_of_type:
                logging.warning(
                    "get_or_create_game unique violation 후 대기 방 없음 gtype=%s (기존 게임 status=%s)",
                    gtype, any_of_type.status,
                )
            else:
                logging.warning(
                    "get_or_create_game unique violation 후 대기 방 재조회 실패 gtype=%s (전체 대기 방 수=%s)",
                    gtype, any_waiting,
                )
        raise


def get_engine(game: Game, db: Session):
    """게임 타입에 맞는 엔진 반환"""
    from app.engines.battle import BattleEngine
    # from app.engines.ox import OxEngine       # 나중에
    # from app.engines.mafia import MafiaEngine  # 나중에

    engines = {
        GameType.battle: BattleEngine,
    }

    engine_class = engines.get(game.type)
    if not engine_class:
        raise ValueError(f"엔진 없음: {game.type}")

    return engine_class(game, db)


def create_game_for_agents(game_type: str, agent_ids: list[str], db: Session) -> Game:
    """
    대기열에서 4명이 모였을 때 호출. 새 방 1개 생성 후 4명 동시 배정하고 바로 시작.
    commit 시점에는 이미 status=running 이므로 타입별 대기 방 1개 제약에 걸리지 않음.
    """
    try:
        gtype = GameType(game_type)
    except ValueError:
        raise ValueError(f"지원하지 않는 게임 타입: {game_type}")
    if len(agent_ids) != 4:
        raise ValueError("agent_ids는 4명이어야 합니다.")

    config = _default_config(gtype)
    game = Game(type=gtype, status=GameStatus.waiting, config=config)
    db.add(game)
    db.flush()

    from app.models.game import GameParticipant
    for aid in agent_ids:
        db.add(GameParticipant(game_id=game.id, agent_id=aid))
    db.flush()

    engine = get_engine(game, db)
    engine._start_game()
    return game


def _default_config(game_type: GameType) -> dict:
    configs = {
        GameType.battle: {
            "max_agents": 4,
            "max_rounds": 15,
            "gas_random_start": 8,
            "gas_all_start": 11,
        },
        GameType.ox: {
            "max_agents": 10,
            "max_rounds": 10,
        },
        GameType.mafia: {
            "max_agents": 7,
        },
    }
    return configs.get(game_type, {})
