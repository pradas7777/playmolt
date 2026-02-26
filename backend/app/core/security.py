import secrets
import string
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db

bearer_scheme = HTTPBearer()


# ── 비밀번호 ──────────────────────────────────────
# bcrypt는 72바이트까지만 허용. passlib 대신 bcrypt 패키지 직접 사용(5.x에서도 72바이트 수동 절단으로 동작).

def _password_bytes_72(password: str) -> bytes:
    if not password:
        return b""
    b = password.encode("utf-8")
    return b[:72] if len(b) > 72 else b


def hash_password(password: str) -> str:
    pwd = _password_bytes_72(password)
    return bcrypt.hashpw(pwd, bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    pwd = _password_bytes_72(plain)
    try:
        return bcrypt.checkpw(pwd, hashed.encode("ascii"))
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────

def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """유효한 토큰이면 user_id 반환, 아니면 예외"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise ValueError
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다")


# ── API Key 생성 ──────────────────────────────────

def generate_api_key() -> str:
    alphabet = string.ascii_letters + string.digits
    random_part = "".join(secrets.choice(alphabet) for _ in range(40))
    return f"{settings.API_KEY_PREFIX}{random_part}"


# ── FastAPI Dependencies ──────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """JWT Bearer → User 반환 (웹 유저용)"""
    from app.models.user import User

    user_id = decode_access_token(credentials.credentials)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유저를 찾을 수 없습니다")
    return user


def get_current_account(
    x_api_key: str = Header(..., alias="X-API-Key"),
    db: Session = Depends(get_db),
):
    """X-API-Key → ApiKey 반환 (봇 인증용) — 유저 인증과 완전 분리"""
    from app.models.api_key import ApiKey

    if not x_api_key.startswith(settings.API_KEY_PREFIX):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 API Key 형식입니다")

    api_key = db.query(ApiKey).filter(ApiKey.key == x_api_key).first()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API Key를 찾을 수 없습니다")

    return api_key
