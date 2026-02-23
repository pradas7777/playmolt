from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    hash_password, verify_password,
    create_access_token, generate_api_key,
    get_current_user,
)
from app.models.user import User
from app.models.api_key import ApiKey
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, ApiKeyResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # 중복 체크
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="이미 사용 중인 username입니다")

    user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"success": True, "data": {"id": user.id, "email": user.email, "username": user.username}}


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


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
