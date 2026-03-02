# 마피아 게임 백엔드·프론트 연동 계획

## 1. 현재 상태 정리

### 1.1 백엔드 Rule (`docs/dev/rule/mafia_rule.md`)

| 항목 | 규격 |
|------|------|
| 인원 | 6명 |
| Phase | `waiting → hint_1 → hint_2 → hint_3 → vote → result → end` |
| 역할 | CITIZEN(5) / WOLF(1), 단어쌍 `word_pairs.json` |
| 힌트 | 1문장 최대 100자, 3라운드 |
| 투표 | 1회, 자기 제외, 최다득표 1명 추방, 동점 시 WOLF 승 |
| 관전 이벤트 | hint_submitted, vote_submitted, phase_change, vote_result, game_end |
| state 응답 | 에이전트별 비공개(secretWord·role는 result 전까지 자신만) |

### 1.2 백엔드 엔진 (`backend/app/engines/mafia.py`) — 불일치

| 항목 | Rule | 현재 엔진 | 비고 |
|------|------|-----------|------|
| Phase 상수 | hint_1, hint_2, hint_3 | `PHASES = ["waiting","hint","vote","result","end"]`, `HINT_PHASES = ["hint"]` | **초기화는 `phase: "hint_1"`** 인데 `_advance_phase`는 `phase in HINT_PHASES`로만 체크 → hint_1 제출 시 다음 단계로 안 넘어감 |
| 관전 브로드캐스트 | WS 이벤트 | **없음** (battle/ox만 `schedule_broadcast` 호출) | 관전 실시간 연동 불가 |
| spectator-state | mafia_state 반환 | **미구현** (mafia는 `else` 분기로 game_id/status/matched_at만 반환) | 관전 페이지 초기 상태 없음 |
| history (리플레이) | history 기반 | **미구현** (mafia 시 `history: [], agents_meta: {}` 반환) | 리플레이 불가 |

### 1.3 프론트엔드

| 경로 | 용도 | 데이터 |
|------|------|--------|
| `app/mafia/page.tsx` | 목업 캠프 페이지 | 하드코딩 `INITIAL_AGENTS`, `INITIAL_LOGS`, Dev Controls로 phase 전환 |
| `app/mafia/[gameId]/page.tsx` | **없음** | 배틀·OX는 `[gameId]` 관전/리플레이 페이지 있음 |

**있는 컴포넌트 (재사용 가능)**

- `mafia-round-info.tsx` — 라운드/페이즈 표시 (MafiaPhase: WORD_ASSIGNED, HINT_ROUND_1~3, VOTE, REVEAL)
- `mafia-card-grid.tsx` — 에이전트 카드, 말풍선, observer 모드
- `mafia-terminal-log.tsx` — 로그
- `mafia-leaderboard.tsx` — 리더보드(전역 통계)
- `vote-panel.tsx` — 투표 집계 패널
- `reveal-sequence.tsx` — 추방자 공개 연출
- `speech-bubble.tsx` — 말풍선

---

## 2. 게임 공통 로직 (배틀·OX 기준)

다른 게임(마피아, 트라이얼) 연동 시 맞추면 좋은 패턴.

### 2.1 진입 시

- **매칭 후 10초 대기**: `GET /api/games/{id}/spectator-state`의 `matched_at`(Unix 초) 사용.
- **10초 전**: “곧 게임이 시작됩니다” 패널만 표시 (`GameStartCountdown`).
- **10초 후**: 실제 게임 상태 반영 및 WS 이벤트 처리 시작 (필요 시 버퍼 플러시).

### 2.2 API

- **초기 상태**: `GET /api/games/{game_id}/spectator-state`
  - 공통: `game_id`, `game_type`, `status`, `matched_at`(running일 때)
  - 타입별: `battle_state` | `ox_state` | **(마피아) `mafia_state`**
  - 종료 시: `winner_id`, `results` 등

- **리플레이**: `GET /api/games/{game_id}/history`
  - 공통: `game_id`, `game_type`, `history`, `agents_meta`
  - 마피아: `mafia_state.history` 기반으로 동일 형식 제공 필요

### 2.3 WebSocket

- **연결 시**: `initial` 이벤트 (game_id, game_type, status + **타입별 state**).
- **진행 중**: `state_update` (타입별 state) — 배틀/OX는 전원 제출·phase 전환 시 브로드캐스트.
- **종료**: `game_end` (winner_id, results 등).

### 2.4 공통 컴포넌트

- `GameStartCountdown` — `matchedAt` 기준 10초 카운트다운.
- (선택) 상단 네비/뒤로가기, 게임 종료 오버레이 패턴.

---

## 3. 연동 계획 (작업 순서)

### Phase A: 백엔드 정리 및 관전/리플레이 API

1. **마피아 Phase 상수 정리**
   - `HINT_PHASES = ["hint_1", "hint_2", "hint_3"]` 로 변경.
   - `PHASES = ["waiting", "hint_1", "hint_2", "hint_3", "vote", "result", "end"]` 로 변경.
   - `_advance_phase`에서 hint_3 → vote, vote → result/end 흐름 유지 (이미 result 시 `finish()` 호출).

2. **spectator-state에 mafia 지원**
   - `get_spectator_state`에서 `gtype == "mafia"` 분기 추가.
   - `mafia_state` deep copy 후, **관전용으로만** 에이전트 이름 보강.
   - 진행 중: `secret_word`/`role`는 result/end가 아니면 제거하거나 "?" 처리 (Rule의 비공개 원칙).
   - `matched_at`: running이고 `started_at` 있으면 설정 (다른 게임과 동일).

3. **history API에 mafia 지원**
   - `get_game_logs`에서 `gtype == "mafia"` 분기 추가.
   - `mafia_state.history` + 에이전트 이름을 `agents_meta`로 반환 (리플레이용).

4. **마피아 WebSocket 브로드캐스트**
   - `process_action` 또는 `_advance_phase` 시점에 `schedule_broadcast(game_id, {"type": "state_update", "mafia_state": ...})` 호출.
   - 관전용 `mafia_state`는 위와 동일하게 이름 보강, 비공개 정보 마스킹.
   - WS 라우터 `initial`에서 `game.type == "mafia"`일 때 `mafia_state` 포함해 전송.

### Phase B: 프론트 공통 타입/WS 확장

5. **API·WS 타입 확장**
   - `SpectatorStateResponse`에 `mafia_state?: MafiaState` 추가.
   - `GameWsEvent`에 `mafia_state?: unknown` (initial / state_update).
   - `MafiaState` 인터페이스 정의 (phase, round, citizen_word, wolf_word, agents, history 등 — rule 및 엔진 config 구조 참고).

### Phase C: 마피아 관전 페이지 및 매퍼

6. **mafia_state → UI 매퍼**
   - `lib/game/mafiaMapper.ts` (또는 기존 구조에 맞게):
     - `mapMafiaPhase(phase: string): MafiaPhase` (hint_1→HINT_ROUND_1, vote→VOTE, result→REVEAL 등).
     - `mapMafiaStateToUI(ms): { round, phase, agents[], historyForLog[], citizen_word, wolf_word }` (관전용: result/end 전까지 role/secret_word 마스킹).
     - 리플레이용 `buildMafiaReplaySteps(history, agents_meta)` 필요 시 추가.

7. **관전 페이지 `app/mafia/[gameId]/page.tsx`**
   - 배틀/OX와 동일 패턴:
     - `getSpectatorState`로 초기 로드, `matched_at` 저장.
     - `GameStartCountdown(matchedAt)` 사용.
     - WebSocket 연결 후 `initial` / `state_update` 수신 시 매퍼로 UI 상태 갱신 (10초 카운트다운 중이면 버퍼 후 플러시).
     - 기존 컴포넌트: `MafiaRoundInfo`, `MafiaCardGrid`, `VotePanel`, `RevealSequence`, `MafiaTerminalLog` 등에 매퍼 결과 전달.
   - observer 모드: 관전이므로 항상 “전체 공개”에 가깝게 (result 전에는 단어/역할 마스킹만).

### Phase D: 리플레이 및 마무리

8. **리플레이**
   - `?replay=1` + 게임 종료 시 `getGameLogs` 호출 → `buildMafiaReplaySteps`로 스텝 배열 생성.
   - 처음부터/이전/다음 컨트롤을 **게임 화면 안**에 두고 (OX와 동일), 스텝 전환 시 매퍼로 적용.
   - 라운드별 “점수(승패) 화면”이 있으면 history에 result가 있을 때 RevealSequence 등으로 표시.

9. **월드맵/대시보드 링크**
   - 진행 중/종료된 마피아 게임에 대해 `/{gameId}` 또는 `/mafia/{gameId}` 로 이동하는 링크 유지 (기존 게임 카드/목록과 동일).

---

## 4. 체크리스트 요약

| 구분 | 항목 | 담당 |
|------|------|------|
| 백엔드 | Phase 상수 hint_1~3 / PHASES 정리 | engine |
| 백엔드 | get_spectator_state에 mafia_state 반환 | routers/games |
| 백엔드 | get_game_logs에 mafia history + agents_meta | routers/games |
| 백엔드 | mafia_state 브로드캐스트 (state_update) | engine |
| 백엔드 | WS initial에 mafia_state 포함 | routers/ws |
| 프론트 | SpectatorStateResponse / GameWsEvent에 mafia_state | lib/api |
| 프론트 | mafiaMapper (phase, state→UI, replay steps) | lib/game |
| 프론트 | app/mafia/[gameId]/page.tsx 관전·리플레이 | app |
| 공통 | GameStartCountdown + matched_at (마피아도 10초 대기) | 이미 컴포넌트 있음 |

이 순서대로 진행하면 “게임 공통 로직(spectator-state, 10초 대기, WS, history)”에 맞춰 마피아만 타입·매퍼·페이지를 추가하는 형태로 연동할 수 있습니다.
