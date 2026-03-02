# 배틀 관전 화면 구현 계획 & 체크리스트

진행 중 게임이 화면에 제대로 나오지 않을 때(404 등) 점검 및 개선용 문서.

---

## 1. 목표

- **/battle**  
  진행 중·대기 중 배틀 게임 목록 표시 → **Watch** 클릭 시 해당 게임 관전 페이지로 이동.
- **/battle/[gameId]**  
  해당 게임의 실시간 관전 화면(에이전트 카드, 라운드, 가스, 로그, 게임 종료 오버레이).

---

## 2. 404 원인과 대응

| 원인 | 대응 |
|------|------|
| 라우트 순서 | `GET /{game_id}/spectator-state` 를 `GET /{game_id}` **보다 먼저** 등록. (이미 반영됨) |
| 게임 없음 | 목록에서 보이던 게임이 그 사이에 종료/정리됨. → 목록 새로고침 후 다시 시도. |
| 잘못된 gameId | URL에 붙여넣은 ID가 실제 DB 게임 ID와 다름. → /battle 목록에서 Watch로만 진입. |

---

## 3. 구현 계획 (단계별)

### Phase A: API·라우팅

- [x] **A-1** 백엔드 `GET /api/games/{id}/spectator-state` (인증 없음) 구현
- [x] **A-2** 라우트 순서: `/{game_id}/spectator-state` → `/{game_id}` 순으로 등록
- [ ] **A-3** (선택) spectator-state 404 시 로그에 `game_id` 남기기 (디버깅용)

### Phase B: 목록 → 관전 진입

- [x] **B-1** `/battle` 에서 `GET /api/games?game_type=battle` 로 목록 조회
- [x] **B-2** 각 게임 카드에 `Watch` → `/battle/[gameId]` 링크
- [ ] **B-3** 목록 자동 새로고침(예: 30초) 또는 "새로고침" 버튼

### Phase C: 관전 페이지 로드

- [x] **C-1** 페이지 진입 시 `getSpectatorState(gameId)` 호출
- [x] **C-2** 404 → `/battle` 로 리다이렉트
- [x] **C-3** `status === "finished"` → 결과만 표시, WebSocket 미연결
- [ ] **C-4** 로딩 중 스피너/스켈레톤 표시
- [ ] **C-5** 404/에러 시 "게임을 찾을 수 없습니다" 메시지 + `/battle` 링크 (즉시 리다이렉트 대신)

### Phase D: 실시간 연동 (WebSocket)

- [x] **D-1** `GameWebSocket` 연결: `ws/games/{gameId}`
- [x] **D-2** `initial` / `state_update` → UI 상태 반영 (에이전트, 라운드, 가스)
- [x] **D-3** `round_end` → 라운드 증가, 가스 여부 반영
- [x] **D-4** `game_end` → GameOverOverlay, WebSocket 해제
- [ ] **D-5** 끊김 시 "Reconnecting..." 배너 + 재연결 후 상태 다시 맞추기

### Phase E: UI 매핑·애니메이션

- [x] **E-1** `battleMapper`: `battle_state` → 에이전트 카드용 상태 (hp, energy, isActive, isDead 등)
- [x] **E-2** `round_log` → RoundLogPanel / BattleTerminalLog 항목
- [x] **E-3** 공격/방어 시 카드 애니메이션·방어 이펙트 트리거
- [ ] **E-4** 게임 시작 전(waiting)일 때 "대기 중 — N/4명" 등 안내 문구
- [ ] **E-5** 에이전트 4명 미만일 때 카드 빈 칸 또는 플레이스홀더

### Phase F: 엣지 케이스

- [x] **F-1** 게임 없음(404) → 리다이렉트 또는 안내 후 목록으로
- [x] **F-2** 이미 종료된 게임 → 결과만 표시
- [x] **F-3** WebSocket 끊김 → 자동 재연결(3초)
- [ ] **F-4** 관전 중 게임이 종료됐을 때 `game_end` 수신 후 오버레이만 보여주고 WebSocket 종료 (이미 구현된 흐름 점검)

---

## 4. 체크리스트 (한 번에 확인용)

```
백엔드
[ ] GET /api/games → 200, battle 목록 반환
[ ] GET /api/games/{유효한-id}/spectator-state → 200, battle_state 포함
[ ] GET /api/games/{없는-id}/spectator-state → 404
[ ] 라우터에 spectator-state 가 {game_id} 보다 위에 등록됨

프론트
[ ] /battle 접속 시 게임 목록 로드
[ ] Watch 클릭 → /battle/[gameId] 이동, URL의 gameId 와 요청 gameId 일치
[ ] 관전 페이지에서 404 나면 /battle 으로 이동 또는 안내
[ ] 진행 중 게임: 에이전트 카드·라운드·가스·로그 표시
[ ] WebSocket 끊기면 "Reconnecting..." 표시 후 재연결
[ ] 게임 종료 시 GameOverOverlay (승자·포인트)
```

---

## 5. 로컬에서 빠르게 확인하는 방법

1. 백엔드 실행 후  
   `GET http://localhost:8000/api/games?game_type=battle`  
   → 목록에 나오는 `id` 하나 복사.
2.  
   `GET http://localhost:8000/api/games/{복사한-id}/spectator-state`  
   → 200 + `battle_state` 오면 라우팅·API 정상.
3. 브라우저에서 `/battle` → 목록에서 해당 게임 **Watch** 클릭 → 관전 화면 진입 및 실시간 반영 확인.

---

## 6. 참고

- API: `docs/dev/admin-api.md`, `docs/dev/frontend-backend-guide.md`
- 배틀 엔진: `backend/app/engines/battle.py`
- WebSocket: `backend/app/routers/ws.py`, `frontend/lib/api/websocket.ts`
