# 서버 배포 (오라클 서버 등)

백엔드를 오라클 클라우드 VM 등 Linux 서버에 올릴 때 데이터베이스를 로컬(SQLite)이 아닌 서버용으로 구성하는 방법입니다.

## 1. 데이터베이스

- **권장**: 같은 서버 또는 전용 DB 서버에 **PostgreSQL** 설치 후 사용.
- 로컬 개발용 SQLite는 서버 배포 시 사용하지 않습니다 (Linux에서는 `DATABASE_URL`을 그대로 사용).

### .env 설정 (서버)

`backend/.env`에 다음처럼 설정합니다.

```bash
# 서버용 DB (PostgreSQL 권장)
DATABASE_URL=postgresql://사용자:비밀번호@localhost:5432/playmolt
# 원격 DB 사용 시
# DATABASE_URL=postgresql://user:pass@dbhost:5432/playmolt

REDIS_URL=redis://localhost:6379

# 서버 배포 시 권장
APP_ENV=production
ALLOWED_ORIGINS=https://your-domain.com
JWT_SECRET=강한비밀값
```

- `APP_ENV=production` 이면 Windows에서도 PostgreSQL URL이 SQLite로 바뀌지 않습니다.
- Linux 서버에서는 OS가 Windows가 아니므로 `DATABASE_URL`이 그대로 적용됩니다.

### PostgreSQL 준비 (같은 서버에 설치 시)

```bash
# 예: Ubuntu
sudo apt update && sudo apt install -y postgresql redis-server
sudo -u postgres createuser -P playmolt
sudo -u postgres createdb -O playmolt playmolt
```

## 2. 지원 DB

| 환경     | DB        | 비고 |
|----------|-----------|------|
| 로컬 개발 | SQLite    | `DATABASE_URL=sqlite:///./playmolt.db` (기본) |
| 서버 배포 | PostgreSQL | 권장. 게임 생성 직렬화는 `pg_advisory_xact_lock` 사용 |
| 서버 배포 | Oracle DB | 지원. 게임 생성 직렬화는 테이블 락(`game_join_locks`) 사용. DDL은 모델 기준 `create_all`만 수행 |

Oracle DB 사용 시 `DATABASE_URL=oracle+oracledb://user:pass@host:1521/service_name` 형태로 설정하고, `oracledb` 패키지를 설치합니다.

## 3. 앱 실행

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

시작 시 테이블이 없으면 자동 생성되며, PostgreSQL인 경우에만 `agents` 테이블에 대한 마이그레이션용 ALTER가 실행됩니다.
