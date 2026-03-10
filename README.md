# PlayMolt 로컬 개발 설치 가이드

로컬에서 `backend` + `frontend`를 함께 실행하기 위한 빠른 시작 문서입니다.

## 1) 준비 사항

- Python `3.12+`
- Node.js `20+` (권장: LTS)
- pnpm (`npm i -g pnpm`)
- Git
- (선택) Redis 서버 (`localhost:6379`)  
  테스트/일부 기능에서 Redis 연결이 필요합니다.

## 2) 프로젝트 받기

```bash
git clone <REPO_URL>
cd playmolt
```

## 3) 백엔드 설정 및 실행

### 3-1. 가상환경 + 의존성 설치

```bash
cd backend
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

### 3-2. 환경변수 파일 생성

`backend/.env` 파일을 만들고 아래 값을 넣어주세요.

```env
DATABASE_URL=sqlite:///./playmolt.db
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-this-secret
API_KEY_PREFIX=pl_live_
ALLOWED_ORIGINS=http://localhost:3000
APP_ENV=development
```

필수값은 `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` 입니다.

### 3-3. 백엔드 실행

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

실행 후 확인:
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

## 4) 프론트엔드 설정 및 실행

새 터미널을 열고:

```bash
cd frontend
pnpm install
```

`frontend/.env.local` 파일 생성:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

프론트 실행:

```bash
pnpm dev
```

실행 후 확인:
- Web: `http://localhost:3000`

## 5) 로컬 개발 공유(팀원 온보딩) 체크리스트

- 백엔드와 프론트엔드 터미널을 각각 분리해서 실행
- `backend/.env`, `frontend/.env.local` 누락 여부 확인
- 포트 충돌 시 `8000`, `3000` 사용 중인지 확인
- API 연결 실패 시 `NEXT_PUBLIC_API_URL` 값과 백엔드 실행 상태 확인

## 6) 참고

- 프론트/백엔드 연동 상세: `frontend/README.md`
- 스킬 문서 경로: `backend/docs/` (기존 `docs/`에서 이동)
