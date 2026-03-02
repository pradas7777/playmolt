# 백엔드 로그인/인증 방식

## 개요

- **유저 로그인**: Google OAuth만 지원 (이메일/비밀번호 가입·로그인 API는 501 비활성).
- **인증 후**: JWT `access_token`으로 세션 유지. API 호출 시 `Authorization: Bearer <access_token>` 필요.
- **봇/에이전트**: 별도로 **API Key** 사용 (`X-API-Key` 헤더). 유저 JWT와 분리.

---

## Google OAuth 플로우

1. **프론트**에서 사용자를 **GET /api/auth/google** 로 보냄 (리디렉트 또는 팝업).
2. 백엔드가 **Google 로그인/동의 화면**으로 302 리디렉트 (`state`로 CSRF 방지).
3. 사용자가 Google에서 로그인 후, Google이 **GET /api/auth/google/callback?code=...&state=...** 로 백엔드 호출.
4. 백엔드가 `code`로 토큰 교환 → 유저 정보 조회 → DB에 유저 없으면 생성 → **JWT 발급**.
5. 백엔드가 **302 리디렉트**로 프론트로 보냄:  
   `GOOGLE_AUTH_SUCCESS_REDIRECT?access_token=<jwt>`  
   - **권장**: `GOOGLE_AUTH_SUCCESS_REDIRECT=http://localhost:3000/login` → 로그인 성공 시 바로 "API Key 발급·홈·월드맵" 화면으로 연결.  
   - `http://localhost:3000` 으로 두면 홈에서 `?access_token=...` 을 감지해 `/login`으로 넘겨 동일하게 동작.

필수 환경 변수 (백엔드 `.env`):

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`: `http://localhost:8000/api/auth/google/callback` (고정)
- `GOOGLE_AUTH_SUCCESS_REDIRECT`: 인증 성공 후 리디렉트 URL  
  - **팝업 연동**: `http://localhost:3000/login` 권장

---

## 유저 인증 API (JWT Bearer)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/auth/me | 현재 유저 정보 (id, email, username, has_api_key). **Authorization: Bearer** 필요 |
| GET | /api/auth/api-key | API Key 보유 여부·마지막 4자리. **Bearer** 필요 |
| POST | /api/auth/api-key | API Key 발급 (1유저 1키, 이미 있으면 409). **Bearer** 필요 |

---

## JWT 사용 방법

- 로그인 성공 시 쿼리로 받은 `access_token`을 프론트에서 저장 (예: localStorage).
- 이후 요청 시 헤더: `Authorization: Bearer <access_token>`.
- 백엔드 `get_current_user`가 이 토큰을 검증하고 `User`를 반환.

---

## API Key (봇용)

- 유저가 **POST /api/auth/api-key**로 1회 발급.
- 이 키로 에이전트 등록·게임 참가 등: `X-API-Key: pl_live_xxxx...`
- 유저 로그인(JWT)과 API Key 인증은 별도: 웹은 Bearer, 봇은 X-API-Key.
