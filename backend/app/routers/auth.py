import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, generate_api_key, get_current_user
from app.models.user import User
from app.models.api_key import ApiKey
from app.schemas.auth import ApiKeyResponse, ApiKeyInfoResponse, UserMeResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Google OAuth
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_SCOPES = "openid email profile"
STATE_EXPIRE_MINUTES = 10


def _make_google_state() -> str:
    payload = {"r": secrets.token_urlsafe(16), "exp": datetime.now(timezone.utc) + timedelta(minutes=STATE_EXPIRE_MINUTES)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _verify_google_state(state: str) -> None:
    try:
        jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="잘못된 state 또는 만료되었습니다. 다시 시도하세요.")


def _unique_username_from_email(db: Session, email: str) -> str:
    local = (email.split("@")[0] or "user")[:20]
    base = re.sub(r"[^a-zA-Z0-9]", "", local) or "user"
    candidate = base
    n = 0
    while db.query(User).filter(User.username == candidate).first():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


@router.post("/register", status_code=status.HTTP_501_NOT_IMPLEMENTED)
def register():
    """이메일 가입 비활성화. 구글 로그인만 사용."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="구글 로그인만 지원합니다. GET /api/auth/google 을 사용하세요.",
    )


@router.post("/login", status_code=status.HTTP_501_NOT_IMPLEMENTED)
def login():
    """이메일 로그인 비활성화. 구글 로그인만 사용."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="구글 로그인만 지원합니다. GET /api/auth/google 을 사용하세요.",
    )


@router.get("/me", response_model=UserMeResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """현재 로그인한 유저 정보 + API Key 보유 여부."""
    return UserMeResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        has_api_key=current_user.api_key is not None,
    )


@router.get("/api-key", response_model=ApiKeyInfoResponse)
def get_api_key_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 유저의 API Key 존재 여부/마지막 4자리 조회 (전체 키는 반환하지 않음)."""
    existing = db.query(ApiKey).filter(ApiKey.user_id == current_user.id).first()
    if not existing:
        return ApiKeyInfoResponse(has_api_key=False, api_key_last4=None)
    key = existing.key or ""
    last4 = key[-4:] if len(key) >= 4 else key
    return ApiKeyInfoResponse(has_api_key=True, api_key_last4=last4)


@router.post("/api-key", response_model=ApiKeyResponse)
def issue_api_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """JWT 로그인한 유저에게 봇용 API Key 발급 (1유저 1키)"""
    existing = db.query(ApiKey).filter(ApiKey.user_id == current_user.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 API Key가 발급되어 있습니다. 기존 키를 사용하세요.")

    new_key = ApiKey(user_id=current_user.id, key=generate_api_key())
    db.add(new_key)
    db.commit()
    db.refresh(new_key)

    return ApiKeyResponse(api_key=new_key.key)


# ── Google OAuth ───────────────────────────────────

@router.get("/google")
def google_login():
    """구글 로그인 페이지로 리디렉트."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="구글 로그인이 설정되지 않았습니다. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET을 설정하세요.")
    state = _make_google_state()
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=302)


@router.get("/google/callback")
def google_callback(
    code: str = Query(..., description="Google에서 전달하는 인증 코드"),
    state: str = Query(..., description="CSRF 방지 state"),
    db: Session = Depends(get_db),
):
    """구글 콜백: 코드 교환 → 유저 조회/생성 → JWT 발급 후 프론트 리디렉트."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="구글 로그인이 설정되지 않았습니다.")
    _verify_google_state(state)

    with httpx.Client() as client:
        token_res = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_res.raise_for_status()
        data = token_res.json()
        access_token = data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="구글 토큰을 받지 못했습니다.")

        userinfo_res = client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_res.raise_for_status()
        info = userinfo_res.json()

    email = info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="구글 계정에서 이메일을 가져올 수 없습니다.")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        username = _unique_username_from_email(db, email)
        user = User(
            email=email,
            username=username,
            password_hash=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(user.id)
    redirect_base = settings.GOOGLE_AUTH_SUCCESS_REDIRECT.rstrip("/")
    redirect_url = f"{redirect_base}?access_token={token}"
    return RedirectResponse(url=redirect_url, status_code=302)
