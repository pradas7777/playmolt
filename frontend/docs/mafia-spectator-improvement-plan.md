# 마피아 게임 실시간 관전화면 개선 계획

**작성일**: 2025-02-25  
**대상**: `/mafia/[gameId]` 실시간 관전 화면

---

## 1. 현재 문제 요약

| 문제 | 현상 | 추정 원인 |
|------|------|-----------|
| 카드 사라짐 | 에이전트 카드가 보이지 않음 | overflow, flex 축소, scale 과소 |
| 카드 가독성 | 에이전트 카드가 잘 안 보임 | `scale-[0.38]` (38%)로 너무 작음 |
| 말풍선 미표시 | 말풍선이 전혀 안 나옴 | phase/hints 타이밍, visibleBubbles 로직 |
| 힌트 로그 일괄 표시 | 한 번에 모두 노출 | `mapMafiaHistoryToLogs` 전체 적용 |
| 순차 재생 부재 | 에이전트별 순차 노출 안 됨 | 로그/말풍선 동시 적용 |

---

## 2. 현재 구조 분석

### 2.1 레이아웃
- **섹션**: `h-full overflow-hidden pt-[72px]` (100vh)
- **카드 그리드**: 좌 3명 / 캠프파이어 / 우 3명 (max-w-[1100px])
- **카드 스케일**: `scale-[0.38] sm:scale-[0.44]` (원본의 38~44%)
- **flex**: `min-h-0`로 인해 여유 공간 부족 시 카드 영역이 0으로 줄어들 수 있음

### 2.2 말풍선 (visibleBubbles)
- `useEffect([phase, agents])`: phase가 HINT_ROUND_1/2/3일 때만 동작
- `agent.hints[roundIndex]`: history + pending_actions에서 채움
- **실시간 이슈**: WS에서 `phase: "hint_1"` + `agents` 수신 시, `history`에 해당 라운드 힌트가 아직 없을 수 있음 (pending_actions에만 있을 수 있음)
- `lastPlayedHintRef`로 phase당 1회만 실행 → 빠른 phase 전환 시 말풍선 스킵 가능

### 2.3 이벤트 큐 (MafiaEventQueue)
- `hint_1/2/3`: 6 × 800ms = 4800ms 대기 후 다음 state 적용
- state 적용 시 `applyMafiaState` → phase, agents, logs 한 번에 세팅

### 2.4 로그
- `mapMafiaHistoryToLogs(ms.history)`: history 전체 → 로그 배열로 변환 후 한 번에 `setLogs`
- 라운드/에이전트 구분 없는 일괄 표시

---

## 3. 개선 계획

### Phase 1: 카드 표시 고정 및 크기 개선 (1~2일)

#### 3.1.1 카드 사라짐 방지 ✅ (2025-02-25 적용)
- [x] `overflow-hidden` → `overflow-visible`로 변경 (카드 클리핑 방지)
- [x] flex 컨테이너에 `min-h-[280px]`, 열에 `min-h-[200px]` 적용
- [x] MafiaCardGrid에 `agents.length === 0`일 때 PlaceholderCard 6개 표시

#### 3.1.2 카드 크기 확대 ✅ (2025-02-25 적용)
- [x] `scale-[0.38] sm:scale-[0.44]` → `scale-[0.55] sm:scale-[0.6] md:scale-[0.65]` 상향

#### 3.1.3 화면에 딱 맞게 ✅ (2025-02-25 적용)
- [x] 상위 flex에 `min-h-0`, RoundInfo에 `shrink-0` 적용
- [x] CardGrid를 `flex-1 min-h-0` 래퍼로 감싸 공간 확보

---

### Phase 2: 말풍선 표시 및 순차 재생 (2~3일) ✅

#### 3.2.1 말풍선 미표시 원인 수정
- [x] **실시간 힌트 소스**: `getHintsWithPending`가 `pending_actions`를 제대로 사용하는지 확인
- [x] phase와 agents 동기화: `applyMafiaState` 내부에서 hints가 채워진 agents를 한 번에 set
- [x] `lastPlayedHintRef` 로직: phase당 한 번만 말풍선 보여주기

#### 3.2.2 라운드별 / 에이전트별 순차 재생
- [x] hint_1 수신 → 에이전트 1 말풍선 → 2.5초 대기 → 에이전트 2 말풍선 → … → N명 완료 후 다음 state
- [x] 말풍선 1개당 2.5초 유지 (`HINT_BUBBLE_MS = 2500`)

#### 3.2.3 MafiaEventQueue 연동
- [x] `getDelayMsForPhase("hint_1/2/3")` = `agentCount * 2500` (mafia_state.agents 기반)

---

### Phase 3: 힌트 로그 순차 노출 (1~2일) ✅

#### 3.3.1 로그 구조 변경
- [x] `visibleLogCount` state 추가: 0 ~ logs.length 범위로, 말풍선과 동기화하여 증가

#### 3.3.2 로그 순차 노출 로직
- [x] 말풍선 표시 시 동일 타이밍에 `visibleLogCount` 증가 (에이전트별 1줄씩)
- [x] `mapMafiaHistoryToLogs`에 `agentIdsInOrder` 전달로 에이전트 순서 보장

#### 3.3.3 MafiaTerminalLog 수정
- [x] `visibleCount` prop 추가, `logs.slice(0, visibleCount)`로 표시

---

### Phase 4: 통합 플로우 (1일) ✅

#### 3.4.1 실시간 관전 플로우 정리
1. WS `state_update` 수신 → 큐에 enqueue
2. 큐에서 state 꺼내 `applyMafiaState` 호출
3. phase가 hint_1/2/3이면: 큐가 `agentCount * 2500` ms 대기 후 `processNext`
4. phase 변경 시 bubble effect가 에이전트별 말풍선+로그 순차 재생
5. phase가 vote/result이면 즉시 반영

#### 3.4.2 리플레이 모드
- [x] 리플레이에서도 동일한 `applyMafiaState` 사용 → hint phase 시 말풍선+로그 순차 재생

---

## 4. 파일별 수정 예상

| 파일 | 변경 내용 |
|------|-----------|
| `mafia-card-grid.tsx` | scale 상향, min-height, overflow 조정, 스켈레톤 |
| `mafia/[gameId]/page.tsx` | visibleBubbles/visibleLogCount 로직, 큐와 연동 |
| `mafiaEventQueue.ts` | hint phase 대기 시간 조정, 콜백으로 말풍선 완료 대기 |
| `mafiaMapper.ts` | getHintsWithPending 실시간 데이터 검증 |
| `mafia-terminal-log.tsx` | visibleCount/slice 지원 |
| `speech-bubble.tsx` | 필요 시 디자인/가독성 개선 |

---

## 5. 우선순위 및 일정

| 순위 | Phase | 예상 기간 | 핵심 산출물 |
|------|-------|----------|-------------|
| 1 | Phase 1: 카드 고정/확대 | 1~2일 | 카드 항상 표시, 크기 50%+ |
| 2 | Phase 2: 말풍선 순차 | 2~3일 | 힌트 phase에서 말풍선 정상 표시 |
| 3 | Phase 3: 로그 순차 | 1~2일 | 로그 에이전트별 순차 노출 |
| 4 | Phase 4: 통합 | 1일 | 실시간/리플레이 일관 동작 |

**총 예상 기간**: 5~8일

---

## 6. 체크리스트 (구현 시)

```
[x] 카드가 overflow로 잘리지 않음 (overflow-visible)
[x] 카드 scale 0.5 이상 (0.55~0.65)
[x] agents 빈 배열 시 이전 카드 유지 또는 플레이스홀더 (PlaceholderCard 6개)
[x] HINT_ROUND_1/2/3에서 말풍선 1개 이상 표시됨
[x] 에이전트별 말풍선 순차 (1→2→3→…→N, 2500ms 간격)
[x] 로그가 에이전트별로 순차 노출 (visibleLogCount)
[x] 리플레이에서도 동일 동작
```
