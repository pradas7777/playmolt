from pathlib import Path

from pydantic_settings import BaseSettings
from typing import List, Optional

# Windows/리로드 시 환경변수 인코딩 깨짐 방지: .env를 UTF-8(에러 시 대체)으로 먼저 로드
# config.py 위치: backend/app/core/config.py → 3단계 상위가 backend/
_env_dir = Path(__file__).resolve().parent.parent.parent
_env_path = _env_dir / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_path, encoding="utf-8", errors="replace", override=True)
    except Exception:
        pass


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # API Key
    API_KEY_PREFIX: str = "pl_live_"

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # App
    APP_ENV: str = "development"
    APP_TITLE: str = "PlayMolt API"
    APP_VERSION: str = "0.1.0"

    # Admin (관리자용: 현재 진행 중 게임 일괄 종료 등)
    ADMIN_SECRET: Optional[str] = None

    # 방치 게임 정리: 이 시간(분) 지난 waiting/running 게임은 join 시 자동 finished 처리. 개발 시 5 등으로 짧게 두면 409 완화.
    ABANDONED_GAME_MINUTES: int = 30

    @property
    def origins_list(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        # backend/.env 절대 경로로 고정 (cwd와 무관)
        env_file = str(_env_path.resolve())
        env_file_encoding = "utf-8"


def _load_settings():
    import os
    try:
        return Settings()
    except Exception:
        # pydantic이 env_file을 못 읽는 경우: 여기서 .env를 직접 로드 후 os.environ으로 구성
        if _env_path.exists():
            from dotenv import load_dotenv
            load_dotenv(_env_path, encoding="utf-8", errors="replace", override=True)
        if not os.environ.get("DATABASE_URL"):
            raise RuntimeError(
                f"DATABASE_URL가 없습니다. .env 파일을 확인하세요: {_env_path}"
            ) from None
        return Settings(
            DATABASE_URL=os.environ["DATABASE_URL"],
            REDIS_URL=os.environ["REDIS_URL"],
            JWT_SECRET=os.environ["JWT_SECRET"],
            JWT_ALGORITHM=os.environ.get("JWT_ALGORITHM", "HS256"),
            JWT_EXPIRE_MINUTES=int(os.environ.get("JWT_EXPIRE_MINUTES", "1440")),
            API_KEY_PREFIX=os.environ.get("API_KEY_PREFIX", "pl_live_"),
            ALLOWED_ORIGINS=os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000"),
            APP_ENV=os.environ.get("APP_ENV", "development"),
            APP_TITLE=os.environ.get("APP_TITLE", "PlayMolt API"),
            APP_VERSION=os.environ.get("APP_VERSION", "0.1.0"),
            ADMIN_SECRET=os.environ.get("ADMIN_SECRET") or None,
            ABANDONED_GAME_MINUTES=int(os.environ.get("ABANDONED_GAME_MINUTES", "30")),
        )


settings = _load_settings()
