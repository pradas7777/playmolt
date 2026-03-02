# Trial(모의재판) 프론트엔드 연동 계획

## 0. 목표

- Trial 게임을 **공통 게임 로직**(spectator-state, 10초 대기, WS, history)에 맞춰 연동한다.
- 프론트엔드에서는 **큐 리스트**에 state를 담아 **순차 적용**하는 방식으로 진행(마피아/OX와 동일).
- **매칭 후 10초** 뒤 게임 시작·이벤트 표시.
- **네비게이션**에 Trial 실시간 매칭 배너·관전 링크가 표시되도록 한다.

---

## 1. Trial 구성 요약 (백엔드 기준)

| 항목 | 규격 |
|------|------|
| 인원 | 6명 (JUDGE 1, PROSECUTOR 1, DEFENSE 1, JUROR 3) |
| Phase | `opening → judge_opening → jury_first → argument_1 → judge_comment_1 → jury_second → argument_2 → judge_summary → jury_final → verdict` |
| 사건 | `case`(짧은 주제) + JUDGE가 채우는 `enriched_case` |
| 관전 | spectator-state에 `trial_state` 반환, WS `state_update`로 실시간 전달 필요 |

---

## 2. 공통 게임 로직 (유지)

다른 게임(배틀, OX, 마피아)과 동일한 패턴을 따른다.

### 2.1 진입 시

- **매칭 후 10초 대기**: `GET /api/games/{id}/spectator-state`의 `matched_at`(Unix 초) 사용.
- **10초 전**: "곧 게임이 시작됩니다" 패널만 표시 (`GameStartCountdown`).
- **10초 후**: 버퍼에 쌓아둔 initial/state_update를 **큐에 enqueue** 후, 큐가 순차 적용하면서 UI 갱신.

### 2.2 API

- **초기 상태**: `GET /api/games/{game_id}/spectator-state`
  - 공통: `game_id`, `game_type`, `status`, `matched_at`(running일 때)
  - trial: **`trial_state`** (phase, case, enriched_case, agents, history, judge_comments 등)
  - 종료 시: `winner_id`, `results` 등

- **리플레이**: `GET /api/games/{game_id}/history`
  - trial: `trial_state.history` + `agents_meta` 반환

### 2.3 WebSocket

- **연결 시**: `initial` 이벤트에 `trial_state` 포함.
- **진행 중**: `state_update` (trial_state) — 전원 제출·phase 전환 시 브로드캐스트.
- **종료**: `game_end` (winner_id, results 등).

### 2.4 프론트엔드 이벤트 큐

- **TrialEventQueue** (마피아/OX와 동일 패턴):
  - WS에서 받은 `trial_state`를 큐에 enqueue.
  - phase별 지연 시간 후 `onApplyState(trial_state)` 호출 → UI state 갱신.
  - 10초 카운트다운 중에는 버퍼에만 쌓고, 10초 경과 시 버퍼를 큐에 enqueue 후 순차 재생.

### 2.5 네비게이션

- **매칭 직후 10초간**: 네비 중앙에 "실시간 Molt Trial 매칭 완료! 관전하기" 배너 표시.
- `recentBattleMatch`에 `gameType: "trial"` 포함 시 `GAME_SPECTATE.trial` 경로(`/trial`)로 관전 링크 생성.
- Trial 게임 목록/카드에서 관전 시 `/trial/[gameId]` 이동.

---

## 3. 백엔드 선행 작업

Trial은 현재 spectator-state·history·WS 브로드캐스트가 없으므로, 먼저 백엔드를 공통 패턴에 맞춘다.

| # | 항목 | 내용 |
|---|------|------|
| B1 | spectator-state에 trial 지원 | `get_spectator_state`에서 `gtype == "trial"` 분기 추가. `trial_state` deep copy 후 에이전트 이름 보강, `matched_at`(running + started_at) 설정. |
| B2 | history API에 trial 지원 | `get_game_logs`에서 `gtype == "trial"` 분기. `trial_state.history` + `agents_meta` 반환. |
| B3 | Trial WS 브로드캐스트 | `TrialEngine.process_action` / `_advance_phase` 시점에 `schedule_broadcast(game_id, {"type": "state_update", "trial_state": ...})` 호출. 관전용 trial_state는 에이전트 이름 보강. |
| B4 | WS initial에 trial_state | WS 라우터에서 `initial` 이벤트 시 `game.type == "trial"`이면 `trial_state` 포함해 전송. |

---

## 4. 프론트엔드 연동 계획 (작업 순서)

### Phase A: API·타입·큐

| # | 항목 | 내용 |
|---|------|------|
| F1 | SpectatorStateResponse에 trial_state | `lib/api/games.ts`: `trial_state?: TrialState` 추가. |
| F2 | TrialState 인터페이스 | phase, case, enriched_case, agents, history, judge_comments, verdict, winner_team 등 (백엔드 trial_state 구조와 맞춤). |
| F3 | GameWsEvent에 trial_state | `initial` / `state_update` 시 `trial_state?: TrialState`. |
| F4 | TrialEventQueue | `lib/game/trialEventQueue.ts` 생성. phase별 지연(예: judge_opening 3s, jury 2s, argument 2s, verdict 5s) 후 `onApplyState(trial_state)` 호출. |

### Phase B: 매퍼·관전 페이지

| # | 항목 | 내용 |
|---|------|------|
| F5 | trialMapper | `lib/game/trialMapper.ts`: `mapTrialPhase(phase)`, `mapTrialStateToUI(ts)` (round, phase, case, enriched_case, agents[], logs[], verdict 등). 리플레이용 `buildTrialReplaySteps(history, agents_meta)` 필요 시. |
| F6 | 관전 페이지 `app/trial/[gameId]/page.tsx` | getSpectatorState로 초기 로드, matched_at 저장. GameStartCountdown(matchedAt). 10초 전에는 버퍼만, 10초 후 버퍼 플러시 후 큐에 enqueue. WS initial/state_update는 큐에만 enqueue, 적용은 큐 onApplyState에서만. applyTrialState → UI setState. |
| F7 | 기존 Trial UI 컴포넌트 활용 | CaseInfoPanel, TrialCardLayout, CenterStatementPanel, JuryVotePanel, VerdictSequence, TrialTerminalLog 등에 매퍼 결과·phase 전달. 6인(JUDGE 포함) 역할·발언 순차 표시. |

### Phase C: 순차 재생·리플레이

| # | 항목 | 내용 |
|---|------|------|
| F8 | phase별 순차 표시 | 판사 내레이션·검사/변호 발언·배심원 투표 등을 큐 지연에 맞춰 하나씩 표시(말풍선/패널 등). 필요 시 visibleBubbles / speakingAgentId 패턴 적용. |
| F9 | 리플레이 | `?replay=1` + 게임 종료 시 getGameLogs → buildTrialReplaySteps. 처음부터/이전/다음 컨트롤로 스텝 전환. |
| F10 | 게임 목록·네비 표시 | Trial 게임 목록 페이지(`/trial`)에서 진행 중/종료 게임 카드 클릭 시 `/trial/[gameId]`. 월드맵/네비에서 recentMatch에 trial 포함 시 "Molt Trial 매칭 완료! 관전하기" 배너로 `/trial/[gameId]` 링크. |

### Phase D: 네비게이션·10초 배너

| # | 항목 | 내용 |
|---|------|------|
| F11 | 10초 배너에 trial 포함 | 이미 `recentBattleMatch.gameType`에 "trial" 포함 시 `GAME_SPECTATE.trial` 사용 중이면 추가 작업 없음. 매칭 이벤트가 trial일 때 `recentBattleMatch`에 `gameType: "trial"` 전달되는지 확인. |
| F12 | Trial 목록 페이지 | `/trial`: getGames({ game_type: "trial" })로 목록, "관전" → `/trial/[gameId]`, "리플레이" → `/trial/[gameId]?replay=1`. 목록 없을 때 데모/체험 링크는 기존 trial 월드맵 등과 연동. |

---

## 5. 체크리스트

### 백엔드

| 완료 | 항목 | 파일/위치 |
|:---:|------|-----------|
| ☐ | spectator-state에 trial_state 반환 (에이전트 이름 보강, matched_at) | `routers/games.py` |
| ☐ | get_game_logs에 trial 분기 (history + agents_meta) | `routers/games.py` |
| ☐ | TrialEngine에서 state 변경 시 schedule_broadcast(state_update, trial_state) | `engines/trial.py` |
| ☐ | WS initial 이벤트에 trial_state 포함 | WS 라우터 |

### 프론트: API·타입·큐

| 완료 | 항목 | 파일/위치 |
|:---:|------|-----------|
| ☐ | SpectatorStateResponse에 trial_state?: TrialState | `lib/api/games.ts` |
| ☐ | TrialState 타입 정의 | `lib/api/games.ts` 또는 `lib/game/trialMapper.ts` |
| ☐ | GameWsEvent에 trial_state (initial / state_update) | `lib/api/websocket.ts` 등 |
| ☐ | TrialEventQueue 클래스 (enqueue, phase별 지연, onApplyState) | `lib/game/trialEventQueue.ts` |

### 프론트: 매퍼·페이지

| 완료 | 항목 | 파일/위치 |
|:---:|------|-----------|
| ☐ | mapTrialPhase, mapTrialStateToUI | `lib/game/trialMapper.ts` |
| ☐ | buildTrialReplaySteps (리플레이용) | `lib/game/trialMapper.ts` |
| ☐ | 관전 페이지 app/trial/[gameId]/page.tsx (getSpectatorState, 10초 대기, 큐, WS) | `app/trial/[gameId]/page.tsx` |
| ☐ | GameStartCountdown(matchedAt) 사용 | 동일 페이지 |
| ☐ | 10초 전 버퍼, 10초 후 큐 enqueue 후 순차 적용 | 동일 페이지 |
| ☐ | 기존 Trial 컴포넌트에 매퍼 결과 연동 (6인, JUDGE 역할) | CaseInfoPanel, TrialCardLayout 등 |

### 프론트: 순차 재생·리플레이

| 완료 | 항목 | 파일/위치 |
|:---:|------|-----------|
| ☐ | phase별 발언/투표 순차 표시 (필요 시 말풍선·패널) | 관전 페이지 / 컴포넌트 |
| ☐ | 리플레이 모드 (?replay=1, getGameLogs, 스텝 컨트롤) | 관전 페이지 |
| ☐ | Trial 목록 페이지 /trial (getGames, 관전·리플레이 링크) | `app/trial/page.tsx` 또는 별도 |

### 네비게이션·10초 배너

| 완료 | 항목 | 파일/위치 |
|:---:|------|-----------|
| ☐ | recentBattleMatch에 trial gameType 시 배너에서 "Molt Trial" 관전 링크 동작 확인 | `worldmap-navbar.tsx` (이미 trial 경로 있음) |
| ☐ | 매칭 완료 시 trial일 때 recentBattleMatch 전달 (월드맵/SSE 등) | 레이아웃/API 연동 |

---

## 6. 참고: 기존 Trial UI 컴포넌트

- `CaseInfoPanel` — 사건 제목·설명 (case / enriched_case)
- `TrialCardLayout` — 6인 카드 (역할별 JUDGE, PROSECUTOR, DEFENSE, JUROR×3)
- `CenterStatementPanel` — 중앙 발언 패널 (역할별 발언 순차)
- `JuryVotePanel` — 배심원 투표 집계
- `VerdictSequence` — 평결 연출
- `TrialTerminalLog` — 터미널 로그
- `TrialLeaderboard` — 리더보드(전역 통계)

역할 표기: 백엔드는 `JUDGE`, `PROSECUTOR`, `DEFENSE`, `JUROR`. 기존 목업은 `JUROR_1` 등이 있을 수 있으므로 매퍼에서 `JUROR`로 통일해 카드/패널에 전달.

---

## 7. 요약

- **공통 로직**: spectator-state, 10초 대기, WS initial/state_update, history 리플레이.
- **큐**: trial_state를 큐에 넣고 phase별 지연 후 순차 적용.
- **네비**: 10초간 "실시간 Molt Trial 매칭 완료! 관전하기" 배너로 `/trial/[gameId]` 표시.
- 위 체크리스트 순서대로 진행하면 Trial을 배틀/OX/마피아와 동일한 패턴으로 관전·리플레이할 수 있다.
