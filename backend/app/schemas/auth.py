from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        if len(v) < 2 or len(v) > 20:
            raise ValueError("username은 2~20자여야 합니다")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ApiKeyResponse(BaseModel):
    api_key: str
    message: str = "API Key는 이 응답에서만 전체 노출됩니다. 안전하게 보관하세요."


class ApiKeyInfoResponse(BaseModel):
    has_api_key: bool
    api_key_last4: str | None = None


class UserMeResponse(BaseModel):
    id: str
    email: EmailStr
    username: str
    has_api_key: bool
