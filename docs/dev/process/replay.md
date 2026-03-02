1. 이벤트 큐
lib/game/eventQueue.ts: 옵션에 onAfterEvent 추가. 이벤트 처리 후 한 번 호출되어 리플레이 진행 인덱스 갱신에 사용.

2. 리플레이 초기 상태
lib/game/wsToEvents.ts: buildInitialStateFromReplay(history, agents_meta) 추가.
history[0]이 phase: "game_start"이면 그 시점의 agents/round로 초기 상태 생성.
아니면 agents_meta만으로 4명, HP 4, 라운드 1로 생성.

3. 게임 오버 → 리플레이
components/battle/game-over-overlay.tsx
onWatchReplay prop 추가.
버튼 문구를 "리플레이 보기"로 변경. 클릭 시 onWatchReplay ?? onDismiss 호출.
app/battle/[gameId]/page.tsx
lastGameEndRef: WS에서 game_end 수신 시 winner_id, results 저장.
isReplayMode, replayTotalEvents, replayPlayedCount 상태 추가.
replayEventsRef, replayInitialStateRef, isReplayModeRef 추가.
handleWatchReplay:
getGameLogs(gameId) → buildInitialStateFromReplay → 화면 상태 초기화 →
historyToEvents + 마지막에 game_end 이벤트 넣어서 큐에 enqueueAll → 리플레이 모드 ON.
handleReplayRestart: 저장해 둔 초기 상태로 되돌리고, 같은 이벤트 목록으로 큐를 비운 뒤 다시 enqueueAll + resume.
큐 생성 시 onAfterEvent에서 isReplayModeRef.current이면 replayPlayedCount를 1씩 증가.
리플레이 모드일 때는 ReplayMode만 노출, 아니면 PlaybackControls만 노출.
GameOverOverlay에 onWatchReplay={gameFinished ? handleWatchReplay : undefined} 전달.

4. 목록에서 리플레이 진입
app/battle/page.tsx
종료된 게임에는 "리플레이" 버튼 → /battle/[id]?replay=1.
"결과" 버튼 → /battle/[id] (결과만 보기).
진행 중 게임은 "관전"만 노출.
app/battle/[gameId]/page.tsx
useSearchParams로 replay=1 확인.
replayAutoStartedRef로 한 번만 실행되도록 처리.
loading === false, gameFinished === true, replay=1이면 handleWatchReplay() 한 번 호출해 리플레이 자동 시작.

5. 사용 흐름
관전 중 게임 종료 → 게임 오버 화면에서 "리플레이 보기" → 리플레이 재생.
리플레이 중 → ReplayMode의 "처음부터" → 같은 로그로 처음부터 다시 재생.
배틀 목록에서 종료된 게임 "리플레이" → /battle/[id]?replay=1 진입 시 리플레이 자동 시작.
리플레이 재생이 끝나면 다시 게임 오버 화면이 뜨고, "리플레이 보기"로 한 번 더 리플레이 가능.