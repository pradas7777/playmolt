# 관리자 API

서버가 꼬였을 때나 개발 중에 사용하는 관리자 전용 API.

## 인증

- `.env`에 `ADMIN_SECRET` 을 설정한다.
- 요청 시 `X-Admin-Secret` 헤더에 같은 값을 넣어 보낸다.
- `ADMIN_SECRET` 이 없으면 503 (Admin not configured).
- 헤더가 없거나 값이 다르면 401 (Invalid or missing X-Admin-Secret).

## 진행 중 게임 일괄 종료

**POST** `/api/admin/games/close-all-in-progress`

- `waiting`, `running` 상태인 게임을 모두 `finished` 로 바꾼다.
- 에이전트는 다음 `POST /api/games/join` 시 새 게임에 참가할 수 있다.

### 예시 (curl)

```bash
curl -X POST "http://localhost:8000/api/admin/games/close-all-in-progress" \
  -H "X-Admin-Secret: 1234"
```

### 응답 예시

```json
{
  "closed": 3,
  "message": "3개 게임을 종료 처리했습니다."
}
```
