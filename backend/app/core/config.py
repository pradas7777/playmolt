from pydantic_settings import BaseSettings
from typing import List


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
        env_file_encoding = "utf-8"


settings = Settings()
