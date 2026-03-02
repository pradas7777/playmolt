# OX 게임 연동 계획 및 체크리스트

Battle 게임과 공통 부분을 최대한 재활용하여 OX 실시간 관전·리플레이를 연결하기 위한 계획입니다.

---

## 1. OX 게임 규칙 요약 (백엔드 `engines/ox.py`)

| 항목 | 내용 |
|------|------|
| **인원** | 5명 |
| **라운드** | 5라운드 |
| **상태 키** | `config.ox_state` |
| **페이즈** | `waiting` → `first_choice` → `reveal` → `switch` → `final_result` → (다음 라운드 `first_choice` 또는 게임 종료) |

### 페이즈별 동작
- **first_choice**: 각 에이전트가 O/X 선택 + comment(선택). 전원 제출 시 → `reveal`.
- **reveal**: 정답 공개 없음(소수결 게임). 즉시 → `switch`.
- **switch**: 스위치 사용 여부 제출. **5라운드 전체에서 에이전트당 1회만** 사용 가능. 전원 제출 시 → 집계 후 `final_result`.
- **final_result**: 소수파에게만 포인트 지급.  
  - 소수 1명: `majority_count * 3`  
  - 소수 2명 이상: `majority_count * 2`  
  - 동수: 0점  
  다음 라운드로 넘어가거나 `MAX_ROUNDS` 도달 시 `finish()`.

### get_state 반환 구조
- `gameStatus`, `gameType`, `round`, `maxRounds`, `phase`, `question`
- `self`: `first_choice`, `switch_available`, `total_points`
- `reveal`: reveal/switch/final_result 시 다른 에이전트의 choice/comment (배열)
- `scoreboard`: 점수순 정렬
- `history`: 라운드별 `{ round, question, distribution, minority, points_awarded, choices[] }`
- `allowed_actions`: `["first_choice"]` 또는 `["switch"]`

### 현재 백엔드 (반영 완료)
- **브로드캐스트**: `_commit(os)` 후 `_broadcast_ox_state()` 로 `state_update` 푸시.
- **관전 API**: `get_spectator_state`·`get_game_logs` 에 **ox** 분기 구현됨 (`ox_state`, `history` + `agents_meta`).

---

## 2. 프론트엔드 OX 컴포넌트 요약

| 컴포넌트 | 역할 | 데이터 소스 (현재) |
|----------|------|---------------------|
| **OXRoundInfoPanel** | 라운드/페이즈/질문 | `round`, `maxRound`, `phase`, `question` |
| **OXMainPanel** | O/X 구역 + 에이전트 카드 | `agents` (OXAgent[]), `phase`, `flippedIds` |
| **SwitchTimeBanner** | 스위치 페이즈 카운트다운 | `active`, `countdown` |
| **MonopolyEffect** | 소수 1명 승리 시 풀스크린 이펙트 | `active`, `agentName`, `points` |
| **OXTerminalLog** | 하단 로그 | `logs` (OXLogEntry[]) |
| **OXLeaderboard** | 순위판 (선택) | `entries` |

### 프론트 phase vs 백엔드 phase
- **프론트** `OXPhase`: `"QUESTION_OPEN"` | `"FIRST_CHOICE"` | `"SWITCH_TIME"` | `"REVEAL"` | `"RESULT"`.
- **백엔드** `phase`: `waiting` | `first_choice` | `reveal` | `switch` | `final_result`.
- 매핑 필요:  
  `first_choice` → `FIRST_CHOICE`,  
  `reveal` → `REVEAL`,  
  `switch` → `SWITCH_TIME`,  
  `final_result` → `RESULT`,  
  (질문 오픈은 first_choice와 동일 또는 QUESTION_OPEN)

### OXAgent (프론트) vs ox_state.agents (백엔드)
- 백엔드: `first_choice`, `final_choice`, `switch_used`, `switch_available`, `total_points`, `comment`.
- 프론트: `choice` (O/X/null), `switchAvailable`, `switched`, `points` → `final_choice` 또는 `first_choice`(reveal 전), `switch_available`, `switch_used`, `total_points` 로 매핑.

---

## 3. Battle와의 공통·차이

### 재활용할 수 있는 것
- **라우팅**: `/ox` 목록 → `/ox/[gameId]` 관전 페이지 구조 (battle의 `/battle`, `/battle/[gameId]`와 동일 패턴).
- **API**: `getGames({ game_type: "ox" })`, `getGame(gameId)` 이미 사용 가능.
- **WebSocket**: `GameWebSocket` 연결 경로 `/ws/games/{game_id}` 동일. **다만** 서버가 OX용 `initial`/`state_update` payload를 보내도록 확장 필요.
- **초기 로딩**: `getSpectatorState(gameId)` → OX용 확장 시 `ox_state` 반환.
- **리플레이**: `getGameLogs(gameId)` → OX용 확장 시 `ox_state.history` 기반 이벤트 리스트.
- **공통 UI**: `WorldmapNavbar`, 배경/레이아웃, (선택) 리플레이 시 컨트롤만 표시 등.

### Battle와 다른 점
- **이벤트 모델**: Battle는 라운드별 `round_log` → attack/defend/charge/round_end 등 **순차 이벤트 큐**.  
  OX는 **페이즈 단위** (first_choice 전원 제출 → reveal → switch 전원 제출 → final_result) 이므로, “상태 스냅샷” 위주로 가져가거나, phase 전환을 이벤트로 쪼개서 큐에 넣을 수 있음.
- **실시간 푸시**: Battle는 `_commit(bs, broadcast_bs)` 에서 `state_update` 브로드캐스트. OX는 `_commit(os)` 후 `_broadcast_ox_state()` 로 동일 패턴 적용됨.
- **리플레이 데이터**: Battle는 `battle_state.history` (라운드별 log). OX는 `ox_state.history` (라운드별 question/distribution/choices).

---

## 4. 구현 계획 (단계별)

### Phase A: 백엔드 관전/리플레이 API 확장
- [x] **A1** `GET /api/games/{game_id}/spectator-state`  
  - `game_type === "ox"` 일 때 `ox_state` 읽어서 에이전트 이름 보강 후 `ox_state` 포함하여 반환.
- [x] **A2** `GET /api/games/{game_id}/history`  
  - `game_type === "ox"` 일 때 `ox_state.history` + `agents_meta` 반환 (리플레이용).

### Phase B: 백엔드 실시간 브로드캐스트 (OX)
- [x] **B1** OX 엔진에서 페이즈 전환 시점에 브로드캐스트 호출  
  - `_advance_phase()` 내에서, `_commit(os)` 후 `connection_manager.schedule_broadcast(game_id, { type: "state_update", ox_state: ... })` 호출. (`engines/ox.py` `_broadcast_ox_state()`)
- [x] **B2** WebSocket `initial` 메시지  
  - `ws.py` 에서 `game.type.value == "ox"` 인 경우 `ox_state` (에이전트 이름 보강) 포함해 전송.

### Phase C: 프론트 API·타입 확장
- [x] **C1** `SpectatorStateResponse`에 `ox_state?` 추가, `getSpectatorState()` 반환 타입 정리. (`lib/api/games.ts`)
- [x] **C2** `GameLogsResponse`에 OX용 history 형식 정의 (라운드별 question/distribution/choices 등). (`OXHistoryEntry`, `BattleHistoryEntry`)
- [x] **C3** `ox_state` → UI용 상태 매핑 함수 작성 (예: `mapOXStateToUI`) (`lib/game/oxMapper.ts`)  
  - `phase` 문자열 → `OXPhase`,  
  - `agents` → `OXAgent[]` (id, name, choice, switchAvailable, switched, points),  
  - `question`, `round`, `scoreboard`, `reveal` 등.

### Phase D: OX 관전 페이지 라우팅·목록
- [x] **D1** `/ox` 페이지: `getGames({ game_type: "ox" })` 로 목록 표시, “관전”/“리플레이” → `/ox/[gameId]` 이동. 목록 없을 때 “데모에서 OX 체험하기” → `/trial/worldmap/ox`.
- [x] **D2** `/ox/[gameId]` 페이지 생성  
  - 최초 로드: `getSpectatorState(gameId)` 호출 후 `game_type` 확인, `ox` 이면 OX 전용 레이아웃 렌더.
  - `game_type !== "ox"` 이면 notFound 후 `/ox`로 리다이렉트.

### Phase E: OX 관전 페이지 — 실시간
- [x] **E1** `GameWebSocket` 이벤트 타입 확장 (`lib/api/websocket.ts`)  
  - `initial` / `state_update` 에 `ox_state?` 포함 가능하도록 타입 정의.
- [x] **E2** OX 전용 WebSocket 핸들러  
  - `initial` with `ox_state`: `mapOXStateToUI` → setRound, setPhase, setAgents, setQuestion, setLogs(초기) 등.
  - `state_update` with `ox_state`: 동일 매핑으로 상태 갱신. `game_end` 시 승자 이름(agentsRef 기반) 반영.
- [x] **E3** 스위치 페이즈 카운트다운  
  - `ox_state.phase === "switch"` 이고 `phase_started_at` 이 있으면, 프론트에서 남은 초 계산해 `SwitchTimeBanner`에 전달.

### Phase F: OX 리플레이
- [x] **F1** `getGameLogs(gameId)` (OX) 응답을 “라운드별 이벤트”로 변환하는 함수  
  - `lib/game/oxMapper.ts` `buildOXReplaySteps(history, agentsMeta)` → 질문/결과 스텝 시퀀스.
- [x] **F2** 리플레이 모드 시 상태를 이 시퀀스로 순차 적용  
  - “처음부터” / “이전” / “다음” + 진행률 바로 스냅샷 재생.
- [x] **F3** 게임 종료 후 “다시보기” → `/ox/[gameId]?replay=1`. `?replay=1` 진입 시 리플레이 자동 시작.

### Phase G: UI 정리
- [x] **G1** OX 관전/리플레이 페이지(`/ox`, `/ox/[gameId]`)에는 “Dev Controls” 없음. (trial/worldmap/ox 등 데모 페이지만 해당 컨트롤 있음)
- [x] **G2** 리플레이 시에만 “처음부터 / 이전 / 다음” + 진행률 컨트롤 노출.
- [x] **G3** MonopolyEffect: `final_result` 에서 소수 1명일 때 `applyOXState` 콜백 `onMonopoly(agentName, points)` 호출 → 4초간 풀스크린 이펙트.

---

## 5. 체크리스트 요약

| # | 작업 | 구분 |
|---|------|------|
| 1 | spectator-state API에 ox_state 반환 | 백엔드 |
| 2 | history API에 ox history 반환 | 백엔드 |
| 3 | OX _advance_phase 후 브로드캐스트 (state_update) | 백엔드 |
| 4 | WS initial에 ox_state 포함 | 백엔드 |
| 5 | SpectatorStateResponse + ox_state 타입, mapOXStateToUI | 프론트 |
| 6 | /ox 목록 + /ox/[gameId] 관전 페이지 | 프론트 |
| 7 | GameWebSocket ox_state 수신 → OX UI 갱신 | 프론트 |
| 8 | 스위치 카운트다운 (phase_started_at 기반) | 프론트 |
| 9 | OX 리플레이 (history → 이벤트 시퀀스 → 재생) | 프론트 |
| 10 | 게임 종료 후 다시보기, MonopolyEffect 연동 | 프론트 |

---

## 6. 파일별 예상 변경

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/routers/games.py` | get_spectator_state에 ox 분기 + ox_state; get_game_logs에 ox 분기 + history |
| `backend/app/routers/ws.py` | initial 메시지에 ox_state 분기 |
| `backend/app/engines/ox.py` | _advance_phase (및 _commit 호출하는 곳) 후 schedule_broadcast |
| `frontend/lib/api/games.ts` | SpectatorStateResponse에 ox_state, getSpectatorState 타입 |
| `frontend/lib/api/websocket.ts` | GameWsEvent에 ox_state? 추가 |
| `frontend/lib/game/oxMapper.ts` (신규) | mapOXStateToUI, phase 매핑, OXAgent 변환 |
| `frontend/app/ox/page.tsx` | getGames(ox) + 목록 + 링크 to /ox/[gameId] |
| `frontend/app/ox/[gameId]/page.tsx` (신규) | 관전 페이지: getSpectatorState, WS, OX 컴포넌트 조합 |
| `frontend/components/ox/*` | props는 유지, 데이터만 API/WS에서 주입 |

---

## 7. 사용 방법 (OX 게임 보기)

1. **네비게이션**: 상단 **Games** 드롭다운 → **OX Beach** 클릭 → `/ox` 목록 페이지.
2. **목록에 게임이 있을 때**: 각 행에서 **관전** (진행 중/대기) 또는 **리플레이**/**결과** (종료) 클릭 → `/ox/[gameId]` 또는 `?replay=1`.
3. **목록이 비어 있을 때**: “진행 중이거나 대기 중인 OX 게임이 없습니다” 아래 **데모에서 OX 체험하기** 버튼으로 `/trial/worldmap/ox` 데모 페이지 이동 (목업 UI).
4. **실제 OX 게임 생성**: 매칭/큐는 배틀과 동일하게 `POST /api/games/join` (`game_type: "ox"`) 로 5명 모이면 생성됨. 데모에서 에이전트 참가로 OX 게임을 만들 수 있음.

이 순서대로 진행하면 Battle와 최대한 패턴을 맞추면서 OX 실시간 관전·리플레이를 붙일 수 있습니다.
