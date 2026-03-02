"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"
import { GasWarningBar } from "@/components/battle/gas-warning-bar"
import { GameInfoPanel } from "@/components/battle/game-info-panel"
import { RoundLogPanel, type RoundEvent } from "@/components/battle/round-log-panel"
import { GameOverOverlay } from "@/components/battle/game-over-overlay"
import { RoundTransitionOverlay } from "@/components/battle/round-transition-overlay"
import { BattleTerminalLog, type BattleLogEntry } from "@/components/battle/battle-terminal-log"
import { RoundTimeline } from "@/components/battle/round-timeline"
import { AgoraTop3 } from "@/components/worldmap/agora-top3"

import { getSpectatorState, getGameLogs } from "@/lib/api/games"
import { GameWebSocket } from "@/lib/api/websocket"
import {
  mapBattleStateToUI,
  mapRoundLogToRoundEvents,
  applyLastActionFromLog,
  mapGameEndToResult,
  type MappedAgentState,
} from "@/lib/game/battleMapper"
import { EventQueue } from "@/lib/game/eventQueue"
import { handleBattleEvent } from "@/lib/game/battleEventHandler"
import { battleStateToEvents, gameEndToEvent, historyToEvents, buildInitialStateFromReplay } from "@/lib/game/wsToEvents"
import { ReplayMode } from "@/components/game/ReplayMode"
import { GameStartCountdown } from "@/components/game/GameStartCountdown"

const CARD_FRAME = "/images/cards/battle_game_card.png"
const GAS_START = 8

/** 고정된 표시 순서로 에이전트 정렬 (위치 변경 없이 isActive만 바뀌도록) */
function sortAgentsByStableOrder(
  agents: MappedAgentState[],
  order: string[]
): MappedAgentState[] {
  if (!order.length) return agents
  const byId = new Map(agents.map((a) => [a.id, a]))
  return order.map((id) => byId.get(id)).filter((a): a is MappedAgentState => a != null)
}

function toBattleLogEntry(
  round: number,
  text: string,
  type: BattleLogEntry["type"]
): BattleLogEntry {
  const timestamp = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  return { round, timestamp, text, type }
}

export default function BattleArenaSpectatorPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const gameId = typeof params.gameId === "string" ? params.gameId : ""
  const replayAutoStartedRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [gameFinished, setGameFinished] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const [round, setRound] = useState(0)
  const [maxRound] = useState(15)
  const [phase, setPhase] = useState("WAITING")
  const [agents, setAgents] = useState<MappedAgentState[]>([])
  const [gasActive, setGasActive] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [winnerName, setWinnerName] = useState("")
  const [winnerPoints, setWinnerPoints] = useState(0)
  const [flipped, setFlipped] = useState<boolean[]>([])
  const [roundEvents, setRoundEvents] = useState<RoundEvent[]>([])
  const [terminalLogs, setTerminalLogs] = useState<BattleLogEntry[]>([])
  const [defending, setDefending] = useState<Set<number>>(new Set())
  const [queueTick, setQueueTick] = useState(0)
  const [isReplayMode, setReplayMode] = useState(false)
  const [replayTotalEvents, setReplayTotalEvents] = useState(0)
  const [replayPlayedCount, setReplayPlayedCount] = useState(0)
  /** collect 단계 진입 시각(Unix sec). 턴 남은 시간 계산용 */
  const [collectEnteredAt, setCollectEnteredAt] = useState<number | null>(null)
  const [turnRemainingSec, setTurnRemainingSec] = useState<number | null>(null)
  const [actionOrder, setActionOrder] = useState<string[]>([])
  /** 라운드 전환 시 전체 화면에 표시할 라운드 번호 (3초 후 자동 해제) */
  const [roundTransitionRound, setRoundTransitionRound] = useState<number | null>(null)
  /** 매칭 시각(Unix 초). 10초 카운트다운 패널용 */
  const [matchedAt, setMatchedAt] = useState<number | null>(null)

  const cardRefs = useRef<(AgentCardHandle | null)[]>([])
  const wsRef = useRef<GameWebSocket | null>(null)
  const agentNamesRef = useRef<Record<string, string>>({})
  const prevRoundLogRef = useRef<unknown[]>([])
  const eventQueueRef = useRef<EventQueue | null>(null)
  const agentsRef = useRef<MappedAgentState[]>([])
  const roundRef = useRef(0)
  const lastGameEndRef = useRef<{ winner_id: string | null; results?: unknown[] }>({ winner_id: null })
  const replayEventsRef = useRef<import("@/lib/game/eventQueue").GameEvent[]>([])
  const replayInitialStateRef = useRef<{ agents: MappedAgentState[]; round: number } | null>(null)
  const isReplayModeRef = useRef(false)
  /** 에이전트 카드 위치 고정용. 첫 수신 시 id 순서를 고정하고 이후에는 isActive만 변경 */
  const stableDisplayOrderRef = useRef<string[]>([])
  agentsRef.current = agents
  roundRef.current = round
  isReplayModeRef.current = isReplayMode

  const activeAgent = agents.find((a) => a.isActive) ?? agents[0]

  /** 라운드 전환: 전체 화면 이펙트 표시 후 3초 대기, 다음 라운드용 가운데 로그 초기화 */
  const onRoundTransition = useCallback(async (round: number) => {
    setRoundTransitionRound(round)
    await new Promise((r) => setTimeout(r, 3000))
    setRoundTransitionRound(null)
    setRoundEvents([])
  }, [])

  /** 에이전트 상태만 갱신하고 카드 순서는 고정 (isActive 하이라이트만 변경) */
  const setAgentsSorted = useCallback((updater: (prev: MappedAgentState[]) => MappedAgentState[]) => {
    setAgents((prev) => {
      const next = updater(prev)
      const order = stableDisplayOrderRef.current
      if (!order.length && next.length) stableDisplayOrderRef.current = next.map((a) => a.id)
      return sortAgentsByStableOrder(next, stableDisplayOrderRef.current)
    })
  }, [])

  const handleFlip = useCallback((i: number) => {
    setFlipped((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      return next
    })
  }, [])

  const handleWatchReplay = useCallback(async () => {
    setGameOver(false)
    try {
      const data = await getGameLogs(gameId)
      const { agents: initialAgents, round: initialRound } = buildInitialStateFromReplay(
        data.history,
        data.agents_meta
      )
      Object.assign(
        agentNamesRef.current,
        Object.fromEntries(Object.entries(data.agents_meta).map(([id, m]) => [id, m.name]))
      )
      setAgentsSorted(() => initialAgents)
      setRound(initialRound)
      setPhase("COLLECT")
      setGasActive(initialRound >= 8)
      setFlipped(initialAgents.map(() => false))
      setRoundEvents([])
      setTerminalLogs([])
      setDefending(new Set())
      replayInitialStateRef.current = { agents: initialAgents, round: initialRound }
      const events = historyToEvents(data.history)
      events.push(
        gameEndToEvent(lastGameEndRef.current.winner_id, lastGameEndRef.current.results)
      )
      replayEventsRef.current = events
      setReplayTotalEvents(events.length)
      setReplayPlayedCount(0)
      isReplayModeRef.current = true
      setReplayMode(true)
      eventQueueRef.current?.clear()
      eventQueueRef.current?.enqueueAll(events)
      setQueueTick((t) => t + 1)
    } catch (e) {
      console.error("[Replay] 로그 로드 실패", e)
      setGameOver(true)
    }
  }, [gameId])

  const handleReplayRestart = useCallback(() => {
    const init = replayInitialStateRef.current
    const evs = replayEventsRef.current
    if (!init || !evs.length) return
    setAgentsSorted(() => init.agents)
    setRound(init.round)
    setPhase("COLLECT")
    setGasActive(init.round >= 8)
    setFlipped(init.agents.map(() => false))
    setRoundEvents([])
    setTerminalLogs([])
    setDefending(new Set())
    setGameOver(false)
    setReplayPlayedCount(0)
    eventQueueRef.current?.clear()
    eventQueueRef.current?.enqueueAll(evs)
    eventQueueRef.current?.resume()
    setQueueTick((t) => t + 1)
  }, [])

  // 이벤트 큐 생성 (한 번만)
  useEffect(() => {
    const q = new EventQueue({
      onEvent: async (ev) => {
        await handleBattleEvent(ev, {
          cardRefs,
          getAgents: () => agentsRef.current,
          setAgents: setAgentsSorted,
          setRound,
          setTerminalLogs,
          setRoundEvents,
          setDefending,
          setGasActive,
          setGameOver,
          setWinnerName,
          setWinnerPoints,
          getAgentNames: () => agentNamesRef.current,
          getRound: () => roundRef.current,
          setActionOrder,
          setPhase,
          setCollectEnteredAt,
          onRoundTransition,
        })
      },
      onQueueEmpty: () => setQueueTick((t) => t + 1),
      onAfterEvent: () => {
        if (isReplayModeRef.current) {
          setReplayPlayedCount((c) => c + 1)
        }
      },
      eventDelayMs: 1200,
    })
    eventQueueRef.current = q
    return () => {
      q.clear()
      eventQueueRef.current = null
    }
  }, [])

  // Load initial state
  useEffect(() => {
    if (!gameId) {
      setLoading(false)
      setNotFound(true)
      return
    }
    let cancelled = false
    setLoading(true)
    getSpectatorState(gameId)
      .then((data) => {
        if (cancelled) return
        if (data.matched_at != null) setMatchedAt(data.matched_at)
        if (data.status === "finished") {
          setGameFinished(true)
          setGameOver(true)
          const ui = mapBattleStateToUI(data.battle_state)
          setRound(ui.round)
          setPhase(ui.phase)
          setActionOrder(ui.actionOrder)
          setAgentsSorted(() => ui.agents)
          setGasActive(ui.gasActive)
          agentNamesRef.current = Object.fromEntries(ui.agents.map((a) => [a.id, a.name]))
          const winnerResult = mapGameEndToResult(
            {
              winner_id: data.winner_id ?? null,
              results: data.results ?? [],
            },
            agentNamesRef.current
          )
          setWinnerName(winnerResult.winnerName)
          setWinnerPoints(winnerResult.winnerPoints)
        } else {
          const bs = data.battle_state as { round_log?: unknown[]; collect_entered_at?: number; matched_at?: number }
          if (data.matched_at != null || bs?.matched_at != null) setMatchedAt(data.matched_at ?? bs?.matched_at ?? null)
          const ui = mapBattleStateToUI(bs)
          setRound(ui.round)
          setPhase(ui.phase)
          setActionOrder(ui.actionOrder)
          setAgentsSorted(() => ui.agents)
          setGasActive(ui.gasActive)
          setFlipped(ui.agents.map(() => false))
          agentNamesRef.current = Object.fromEntries(ui.agents.map((a) => [a.id, a.name]))
          if (ui.phase === "COLLECT" && bs.collect_entered_at != null) {
            setCollectEnteredAt(bs.collect_entered_at)
          } else {
            setCollectEnteredAt(null)
          }
          const roundLog = bs?.round_log
          if (roundLog?.length) {
            const roundForLog = Math.max(1, ui.round - 1)
            setRoundEvents(mapRoundLogToRoundEvents(roundLog, ui.agents, roundForLog))
            setAgentsSorted((prev) => applyLastActionFromLog(prev, roundLog))
          }
          setTerminalLogs([
            toBattleLogEntry(ui.round, `Game loaded — Round ${ui.round}`, "ROUND_END"),
          ])
        }
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof Error && e.message.includes("404")) {
          setNotFound(true)
        } else {
          setNotFound(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameId])

  // WebSocket: connect when we have gameId and game is not finished
  useEffect(() => {
    if (!gameId || gameFinished) return
    const ws = new GameWebSocket()
    wsRef.current = ws

    ws.connect(gameId, (event) => {
      if (event.type === "error") {
        if (event.detail === "game_not_found") {
          router.replace("/battle")
          return
        }
        setReconnecting(true)
        return
      }
      setReconnecting(false)

      if (event.type === "initial" && event.battle_state) {
        const bs = event.battle_state as Parameters<typeof mapBattleStateToUI>[0] & { collect_entered_at?: number; round_log?: unknown[] }
        const ui = mapBattleStateToUI(bs)
        const withNames = ui.agents.map((a) => ({
          ...a,
          name: agentNamesRef.current[a.id] || a.name,
        }))
        withNames.forEach((a) => {
          if (a.name !== a.id) agentNamesRef.current[a.id] = a.name
        })
        setRound(ui.round)
        setPhase(ui.phase)
        setActionOrder(ui.actionOrder)
        setAgentsSorted(() => withNames)
        setGasActive(ui.gasActive)
        setFlipped(withNames.map(() => false))
        if (ui.phase === "COLLECT" && bs.collect_entered_at != null) {
          setCollectEnteredAt(bs.collect_entered_at)
        } else {
          setCollectEnteredAt(null)
        }
        if (bs.round_log?.length) {
          const roundForLog = Math.max(1, ui.round - 1)
          setRoundEvents(mapRoundLogToRoundEvents(bs.round_log, ui.agents, roundForLog))
          setAgentsSorted((prev) => applyLastActionFromLog(prev, bs.round_log))
        }
      }

      if (event.type === "state_update" && event.battle_state) {
        const bs = event.battle_state as Parameters<typeof mapBattleStateToUI>[0] & { collect_entered_at?: number }
        const ui = mapBattleStateToUI(bs)
        ui.agents.forEach((a) => {
          if (a.name !== a.id) agentNamesRef.current[a.id] = a.name
        })
        // 라운드/페이즈/타이머는 state_snapshot에서만 반영 (큐 재생 후 일치시키기)
        const events = battleStateToEvents(bs)
        eventQueueRef.current?.enqueueAll(events)
        setQueueTick((t) => t + 1)
      }

      // round_end는 state_update의 battleStateToEvents에서 이미 큐에 포함되어 순서가 보장됨 (별도 enqueue 안 함)
      if (event.type === "round_end") {
        // no-op: collect/round는 state_snapshot 처리 시 반영됨
      }

      if (event.type === "game_end") {
        lastGameEndRef.current = { winner_id: event.winner_id ?? null, results: event.results }
        eventQueueRef.current?.enqueue(
          gameEndToEvent(event.winner_id ?? null, event.results)
        )
        setQueueTick((t) => t + 1)
        // 백엔드는 이미 종료돼도 프론트는 큐 순차 재생이 끝날 때까지 유지. 게임 종료는 큐에서 game_end 처리 시 반영.
      }
    })

    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [gameId, gameFinished, router])

  // Redirect if not found
  useEffect(() => {
    if (notFound) router.replace("/battle")
  }, [notFound, router])

  // 큐에서 game_end 처리 시에만 게임 종료·WS 연결 해제 (순차 재생 끝까지 유지)
  useEffect(() => {
    if (!gameOver) return
    wsRef.current?.disconnect()
    wsRef.current = null
    setGameFinished(true)
  }, [gameOver])

  // 턴 남은 시간 카운트다운 (collect 단계, 1초 간격)
  useEffect(() => {
    if (phase !== "COLLECT" || collectEnteredAt == null) {
      setTurnRemainingSec(null)
      return
    }
    const TURN_SEC = 20
    const tick = () => {
      const remaining = Math.max(0, Math.ceil(collectEnteredAt + TURN_SEC - Date.now() / 1000))
      setTurnRemainingSec(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, collectEnteredAt])

  // URL에 ?replay=1 이고 게임이 이미 종료된 경우 리플레이 자동 시작
  useEffect(() => {
    if (
      !loading &&
      !notFound &&
      gameFinished &&
      gameId &&
      searchParams.get("replay") === "1" &&
      !replayAutoStartedRef.current
    ) {
      replayAutoStartedRef.current = true
      handleWatchReplay()
    }
  }, [loading, notFound, gameFinished, gameId, searchParams, handleWatchReplay])

  if (loading || notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <WorldmapNavbar />
        <p className="font-mono text-muted-foreground">
          {loading ? "Loading..." : "Redirecting..."}
        </p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-background">
      <WorldmapNavbar />

      {/* Reconnecting banner */}
      <AnimatePresence>
        {reconnecting && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            className="fixed top-16 left-0 right-0 z-[60] bg-amber-500/90 text-black text-center py-2 font-mono text-sm font-bold"
          >
            Reconnecting...
          </motion.div>
        )}
      </AnimatePresence>

      <section
        className="relative w-full overflow-hidden pt-[72px]"
        style={{ height: "100vh" }}
      >
        <GameStartCountdown matchedAt={matchedAt} />
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <Image
            src="/images/battle-arena-bg.jpg"
            alt="Battle Arena"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40" />
        </motion.div>

        <AnimatePresence>
          {gasActive && round >= 11 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.25 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 30%, rgba(34,197,94,0.3) 100%)",
              }}
            />
          )}
          {gasActive && round >= GAS_START && round < 11 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.2, 0.4, 0.2] }}
              transition={{ duration: 3, repeat: Infinity }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 50%, rgba(139,92,246,0.35) 100%)",
              }}
            />
          )}
        </AnimatePresence>

        <div className="relative z-10 flex flex-col h-full">
          <GasWarningBar active={gasActive} />
          <div className="pt-3 pb-2">
            <GameInfoPanel
              round={round}
              maxRound={maxRound}
              phase={phase}
              activeAgentName={activeAgent?.name ?? ""}
              turnRemainingSec={turnRemainingSec}
              turnOrderDisplay={actionOrder
                .filter((id) => agents.find((a) => a.id === id) && !agents.find((a) => a.id === id)?.isDead)
                .map((id, i) => ({
                  position: i + 1,
                  name: agents.find((a) => a.id === id)?.name ?? id,
                  isCurrent: i === 0,
                }))}
            />
          </div>

          <div className="flex-1 flex items-center justify-center relative px-4">
            <div className="relative">
              {/* 시계방향: 선공(0) → 우(1) → 우하(2) → 좌하(3). 2행은 좌우 교체 so [0,1,3,2] */}
              <div className="grid grid-cols-2 gap-40">
                {([0, 1, 3, 2] as const).map((agentIndex, slotIndex) => {
                  const agent = agents[agentIndex]
                  if (!agent) return null
                  return (
                    <div key={agent.id} className="relative">
                      <AgentCard
                        ref={(el) => {
                          cardRefs.current[agentIndex] = el
                        }}
                        agentId={agent.id}
                        agentName={agent.name}
                        characterImage={agent.characterImage}
                        cardFramePng={CARD_FRAME}
                        gameType="battle"
                        isActive={agent.isActive}
                        isDead={agent.isDead}
                        isFlipped={flipped[slotIndex] ?? false}
                        onFlip={() => handleFlip(slotIndex)}
                        hp={agent.hp}
                        energy={agent.energy}
                        lastAction={agent.lastAction}
                        persona="AI agent"
                        totalPoints={0}
                        winRate={0}
                        index={slotIndex}
                      />
                      <AnimatePresence>
                        {defending.has(agentIndex) && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: [1, 1.05, 1] }}
                          exit={{ opacity: 0 }}
                          transition={{ scale: { duration: 1.5, repeat: Infinity } }}
                          className="absolute inset-0 rounded-lg border-2 border-blue-400/60 pointer-events-none z-40"
                          style={{
                            boxShadow:
                              "0 0 20px 4px rgba(96,165,250,0.3), inset 0 0 20px 2px rgba(96,165,250,0.1)",
                          }}
                        >
                          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl opacity-60">
                            🛡️
                          </span>
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
                <RoundLogPanel events={roundEvents} currentRound={round} />
              </div>
            </div>
          </div>
          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        {isReplayMode && (
          <ReplayMode
            queueRef={eventQueueRef}
            queueTick={queueTick}
            currentEventIndex={replayPlayedCount}
            totalEvents={replayTotalEvents}
            onRestart={handleReplayRestart}
          />
        )}

        <RoundTransitionOverlay round={roundTransitionRound} />
        <GameOverOverlay
          show={gameOver}
          winnerName={winnerName}
          points={winnerPoints}
          onDismiss={() => setGameOver(false)}
          onWatchReplay={gameFinished ? handleWatchReplay : undefined}
        />
      </section>

      <BattleTerminalLog logs={terminalLogs} />
      <RoundTimeline
        currentRound={round}
        maxRound={maxRound}
        gasStartRound={GAS_START}
        onSelectRound={() => {}}
      />
      <AgoraTop3 />
    </div>
  )
}
