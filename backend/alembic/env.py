"""
Alembic env: 앱과 동일한 DB URL·메타데이터 사용.
실행: backend/ 에서 alembic upgrade head / alembic revision --autogenerate
"""
from logging.config import fileConfig

from sqlalchemy import create_engine, pool
from alembic import context

# 앱의 Base와 모든 모델을 import 해서 autogenerate가 테이블을 인식하도록 함
from app.core.database import Base, engine as app_engine
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

config = context.config
target_metadata = Base.metadata

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def get_url():
    """앱과 동일한 DB URL 사용 (.env / settings 반영)."""
    return str(app_engine.url)


def run_migrations_offline() -> None:
    url = get_url().replace("%", "%%")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = get_url()
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
