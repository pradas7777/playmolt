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


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """Return user_id for a valid token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise ValueError
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")


def generate_api_key() -> str:
    alphabet = string.ascii_letters + string.digits
    random_part = "".join(secrets.choice(alphabet) for _ in range(40))
    return f"{settings.API_KEY_PREFIX}{random_part}"


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """Resolve current user from JWT bearer token."""
    from app.models.user import User

    user_id = decode_access_token(credentials.credentials)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    return user


def get_current_account(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_pairing_code: str | None = Header(None, alias="X-Pairing-Code"),
    db: Session = Depends(get_db),
):
    """Resolve account from Pairing Code header (supports legacy X-API-Key)."""
    from app.models.api_key import ApiKey

    if x_api_key and x_pairing_code and x_api_key != x_pairing_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Pairing-Code and X-API-Key do not match.",
        )

    pairing_code = x_pairing_code or x_api_key
    if not pairing_code:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Pairing Code header is required. Use X-Pairing-Code or X-API-Key.",
        )

    if not pairing_code.startswith(settings.API_KEY_PREFIX):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Pairing Code format.")

    api_key = db.query(ApiKey).filter(ApiKey.key == pairing_code).first()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pairing Code not found.")

    return api_key
