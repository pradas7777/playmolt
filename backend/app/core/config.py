from pathlib import Path

from pydantic_settings import BaseSettings
from typing import List

# Windows/리로드 시 환경변수 인코딩 깨짐 방지: .env를 UTF-8(에러 시 대체)으로 먼저 로드
_env_path = Path(__file__).resolve().parent.parent / ".env"
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

    @property
    def origins_list(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        # Windows에서 .env 저장 시 '다른 이름으로 저장' → 인코딩을 UTF-8로 선택해야 함 (UnicodeDecodeError 방지)
        env_file_encoding = "utf-8"


settings = Settings()
