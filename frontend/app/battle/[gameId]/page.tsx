"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { GameBackToWorldmap } from "@/components/game/game-back-to-worldmap"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"
import { GasWarningBar } from "@/components/battle/gas-warning-bar"
import { RoundLogPanel, type RoundEvent } from "@/components/battle/round-log-panel"
import { GameOverOverlay } from "@/components/battle/game-over-overlay"
import { RoundTransitionOverlay } from "@/components/battle/round-transition-overlay"
import { BattleTerminalLog, type BattleLogEntry } from "@/components/battle/battle-terminal-log"
import { RoundTimeline } from "@/components/battle/round-timeline"
import { AgoraTop3 } from "@/components/worldmap/agora-top3"

import { getSpectatorState, getGameLogs, type SpectatorStateResponse } from "@/lib/api/games"
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
import { WaitingAgentsPanel } from "@/components/game/waiting-agents-panel"
import { fetchAgentPublic, toGameRecords, type AgentPublicResponse } from "@/lib/agents-api"
import { emitAgentPointsUpdated } from "@/lib/agent-points-sync"

const CARD_FRAME = "/images/cards/battle_game_card.png"
const GAS_START = 8
const BATTLE_UI_POSITIONS = {
  lastAction: { x: 25, y: 24 },
  hp: { x: 15, y: 67 },
  energy: { x: 15, y: 88 },
} as const

type AgentProfileMap = Record<string, AgentPublicResponse>

/** 고정 순서로 에이전트 정렬 (위치 변경 없이 isActive만 반영) */
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
  /** Round transition overlay state. */
  const [roundTransitionRound, setRoundTransitionRound] = useState<number | null>(null)
  /** 매칭 시각(Unix 초. 10초 카운트다운용) */
  const [matchedAt, setMatchedAt] = useState<number | null>(null)
  const [waitingAgents, setWaitingAgents] = useState<{ id: string; name: string }[]>([])
  const [gameStatus, setGameStatus] = useState<string>("waiting")
  const [agentProfiles, setAgentProfiles] = useState<AgentProfileMap>({})
  /** 리플레이 시작/재시작 시 카드 리마운트용(이전 게임 하트 잔상 방지) */
  const [replaySessionKey, setReplaySessionKey] = useState(0)

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
  const agentProfilesRef = useRef<AgentProfileMap>({})
  /** 에이전트 카드 위치 고정: 최초 등장한 id 순서로 고정한 뒤 이후는 isActive만 변경 */
  const stableDisplayOrderRef = useRef<string[]>([])
  agentsRef.current = agents
  roundRef.current = round
  isReplayModeRef.current = isReplayMode
  agentProfilesRef.current = agentProfiles

  const loadAgentProfiles = useCallback(async (agentIds: string[], force = false) => {
    const uniqueIds = [...new Set(agentIds.filter(Boolean))]
    const targetIds = force
      ? uniqueIds
      : uniqueIds.filter((id) => agentProfilesRef.current[id] == null)
    if (!targetIds.length) return

    await Promise.all(
      targetIds.map(async (id) => {
        try {
          const profile = await fetchAgentPublic(id)
          setAgentProfiles((prev) => ({ ...prev, [id]: profile }))
        } catch (e) {
          console.warn("[Battle] failed to load agent profile", id, e)
        }
      })
    )
  }, [])
  /** 라운드 전환: 한 번 다음으로 넘어가면 약 3초간. 다음 라운드 사용 시각 로그 초기화 */
  const onRoundTransition = useCallback(async (round: number) => {
    setRoundTransitionRound(round)
    await new Promise((r) => setTimeout(r, 2000))
    setRoundTransitionRound(null)
    setRoundEvents([])
  }, [])

  /** 에이전트 상태만 먼저 반영하고 카드 순서 고정 (isActive 이외만 변경) */
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
    setReplaySessionKey((k) => k + 1)
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
    setReplaySessionKey((k) => k + 1)
    setAgentsSorted(() => init.agents)
    setRound(init.round)
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

  // ?대깽?????앹꽦 (??踰덈쭔)
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
        setWaitingAgents((data as SpectatorStateResponse).waiting_agents ?? [])
        setGameStatus(data.status)
        if (data.status === "finished") {
          setGameFinished(true)
          setGameOver(true)
          const ui = mapBattleStateToUI(data.battle_state)
          setRound(ui.round)
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
          const bs = data.battle_state as { round_log?: unknown[]; matched_at?: number }
          if (data.matched_at != null || bs?.matched_at != null) setMatchedAt(data.matched_at ?? bs?.matched_at ?? null)
          const ui = mapBattleStateToUI(bs)
          setRound(ui.round)
          setAgentsSorted(() => ui.agents)
          setGasActive(ui.gasActive)
          setFlipped(ui.agents.map(() => false))
          agentNamesRef.current = Object.fromEntries(ui.agents.map((a) => [a.id, a.name]))
          const roundLog = bs?.round_log
          if (roundLog?.length) {
            const roundForLog = Math.max(1, ui.round - 1)
            setRoundEvents(mapRoundLogToRoundEvents(roundLog, ui.agents, roundForLog))
            setAgentsSorted((prev) => applyLastActionFromLog(prev, roundLog))
          }
          setTerminalLogs([
            toBattleLogEntry(ui.round, `Game loaded - Round ${ui.round}`, "ROUND_END"),
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
        const bs = event.battle_state as Parameters<typeof mapBattleStateToUI>[0] & { round_log?: unknown[] }
        const ui = mapBattleStateToUI(bs)
        const withNames = ui.agents.map((a) => ({
          ...a,
          name: agentNamesRef.current[a.id] || a.name,
        }))
        withNames.forEach((a) => {
          if (a.name !== a.id) agentNamesRef.current[a.id] = a.name
        })
        setRound(ui.round)
        setAgentsSorted(() => withNames)
        setGasActive(ui.gasActive)
        setFlipped(withNames.map(() => false))
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
        // 라운드/이벤트는 state_snapshot으로 반영 (큰 오류 방지용)
        const events = battleStateToEvents(bs)
        eventQueueRef.current?.enqueueAll(events)
        setQueueTick((t) => t + 1)
      }

      // round_end 및 state_update는 battleStateToEvents로 한 번 처리해 두고 반영 (순서 enqueue 등)
      if (event.type === "round_end") {
        // no-op: collect/round는 state_snapshot 처리만 반영
      }

      if (event.type === "game_end") {
        lastGameEndRef.current = { winner_id: event.winner_id ?? null, results: event.results }
        void loadAgentProfiles(agentsRef.current.map((a) => a.id), true)
        eventQueueRef.current?.enqueue(
          gameEndToEvent(event.winner_id ?? null, event.results)
        )
        setQueueTick((t) => t + 1)
        // 이후에는 종료만 보여주는 등 게임 오류 표시/처리 생략. 게임 종료는 여기서 game_end 처리만 반영.
      }
    })

    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [gameId, gameFinished, router, loadAgentProfiles])

  useEffect(() => {
    if (!agents.length) return
    void loadAgentProfiles(agents.map((a) => a.id))
  }, [agents, loadAgentProfiles])

  useEffect(() => {
    if (!gameOver || !agents.length) return
    void loadAgentProfiles(agents.map((a) => a.id), true)
  }, [gameOver, agents, loadAgentProfiles])

  // Redirect if not found
  useEffect(() => {
    if (notFound) router.replace("/battle")
  }, [notFound, router])

  // 여기서 game_end 처리 후에 게임 종료·WS 연결 해제 (게임 표시 생략 등)
  useEffect(() => {
    if (!gameOver) return
    wsRef.current?.disconnect()
    wsRef.current = null
    setGameFinished(true)
  }, [gameOver])

  // URL에 replay=1 붙여 게임이 이미 종료된 경우 리플레이를 자동 시작
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
        <GameBackToWorldmap />
        <p className="font-mono text-muted-foreground">
          {loading ? "Loading..." : "Redirecting..."}
        </p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-background">
      <GameBackToWorldmap />

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
        className="relative w-full overflow-hidden pt-12"
        style={{ height: "100dvh", minHeight: "100svh" }}
      >
        {matchedAt == null && (
          <WaitingAgentsPanel
            agents={waitingAgents}
            visible={gameStatus === "waiting" && waitingAgents.length > 0}
          />
        )}
        <GameStartCountdown matchedAt={matchedAt} waitingAgents={waitingAgents} />
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

          <div className="flex-1 flex items-center justify-center relative px-4 pt-3">
            <div className="relative">
              {/* 슬롯 배치: 왼쪽(0) 위(1) 아래·찬성(2) 위·반대(3). 2번과 3번 시각 연결 so [0,1,3,2] */}
              <div className="grid grid-cols-2 gap-60">
                {([0, 1, 3, 2] as const).map((agentIndex, slotIndex) => {
                  const agent = agents[agentIndex]
                  if (!agent) return null
                  const profile = agentProfiles[agent.id]
                  const winRate =
                    profile?.total_stats?.win_rate != null
                      ? Math.round(profile.total_stats.win_rate * 100)
                      : undefined
                  return (
                    <div key={`${gameId}-${replaySessionKey}-${agent.id}`} className="relative">
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
                        battleUiPositions={BATTLE_UI_POSITIONS}
                        lastAction={agent.lastAction}
                        persona={profile?.persona_prompt ?? undefined}
                        totalPoints={profile?.total_points}
                        winRate={winRate}
                        gameRecords={profile ? toGameRecords(profile.game_stats) : undefined}
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
                            ?썳截?
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
          <div className="h-8 sm:h-10 flex-shrink-0 shrink-0 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        {isReplayMode && (
          <ReplayMode
            queueRef={eventQueueRef}
            queueTick={queueTick}
          />
        )}

        <RoundTransitionOverlay round={roundTransitionRound} />
        <GameOverOverlay
          show={gameOver}
          winnerName={winnerName}
          points={winnerPoints}
          onDismiss={() => {
            emitAgentPointsUpdated("battle_overlay_dismiss")
            setGameOver(false)
          }}
          onWatchReplay={gameFinished ? handleWatchReplay : undefined}
          onBackToWorldMap={() => emitAgentPointsUpdated("battle_overlay_worldmap")}
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

