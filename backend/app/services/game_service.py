"""
services/game_service.py
게임 자동 배정 서비스.
대기 중인 방이 있으면 배정, 없으면 새로 생성.
동시 join 시 race condition 방지: 타입별 대기 방 1개 제약(Unique) + 생성 실패 시 재조회.
"""
import threading
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.game import Game, GameType, GameStatus

# SQLite(테스트)에서 대기 중인 게임 없을 때 동시 생성 직렬화용
_creation_locks: dict[GameType, threading.Lock] = {}
_creation_locks_mutex = threading.Lock()


def _get_creation_lock(gtype: GameType) -> threading.Lock:
    with _creation_locks_mutex:
        if gtype not in _creation_locks:
            _creation_locks[gtype] = threading.Lock()
        return _creation_locks[gtype]


def get_or_create_game(game_type: str, db: Session) -> Game:
    """
    대기 중인 방 자동 배정. 없으면 새 방 생성.
    동시 호출 시 한 방만 생성되도록 DB 락(select for update) 및 생성 구간 락 사용.
    """
    try:
        gtype = GameType(game_type)
    except ValueError:
        raise ValueError(f"지원하지 않는 게임 타입: {game_type}")

    config = _default_config(gtype)
    dialect_name = db.get_bind().dialect.name

    def do_create() -> Game:
        # PostgreSQL: 같은 트랜잭션에서 advisory lock으로 생성 구간 직렬화
        if dialect_name == "postgresql":
            key = hash(gtype.value) % (2**31)
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

        # 대기 중인 방 찾기 (있으면 해당 행 락)
        existing = (
            db.query(Game)
            .filter(
                Game.type == gtype,
                Game.status == GameStatus.waiting,
            )
            .with_for_update()
            .first()
        )
        if existing:
            return existing

        # 새 방 생성 (동시에 다른 요청이 생성하면 Unique 위반 → 재조회)
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
            db.rollback()
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
            raise

    if dialect_name == "sqlite":
        # SQLite: 스레드 락 + Unique 위반 시 재조회
        with _get_creation_lock(gtype):
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
                db.rollback()
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
                raise

    return do_create()


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
