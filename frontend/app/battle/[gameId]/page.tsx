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

const CARD_FRAME = "/images/cards/battle_game_card.png"
const GAS_START = 8
const BATTLE_UI_POSITIONS = {
  lastAction: { x: 25, y: 24 },
  hp: { x: 15, y: 67 },
  energy: { x: 15, y: 88 },
} as const

/** 怨좎젙???쒖떆 ?쒖꽌濡??먯씠?꾪듃 ?뺣젹 (?꾩튂 蹂寃??놁씠 isActive留?諛붾뚮룄濡? */
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
  /** 留ㅼ묶 ?쒓컖(Unix 珥?. 10珥?移댁슫?몃떎???⑤꼸??*/
  const [matchedAt, setMatchedAt] = useState<number | null>(null)
  const [waitingAgents, setWaitingAgents] = useState<{ id: string; name: string }[]>([])
  const [gameStatus, setGameStatus] = useState<string>("waiting")

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
  /** ?먯씠?꾪듃 移대뱶 ?꾩튂 怨좎젙?? 泥??섏떊 ??id ?쒖꽌瑜?怨좎젙?섍퀬 ?댄썑?먮뒗 isActive留?蹂寃?*/
  const stableDisplayOrderRef = useRef<string[]>([])
  agentsRef.current = agents
  roundRef.current = round
  isReplayModeRef.current = isReplayMode
  /** ?쇱슫???꾪솚: ?꾩껜 ?붾㈃ ?댄럺???쒖떆 ??3珥??湲? ?ㅼ쓬 ?쇱슫?쒖슜 媛?대뜲 濡쒓렇 珥덇린??*/
  const onRoundTransition = useCallback(async (round: number) => {
    setRoundTransitionRound(round)
    await new Promise((r) => setTimeout(r, 2000))
    setRoundTransitionRound(null)
    setRoundEvents([])
  }, [])

  /** ?먯씠?꾪듃 ?곹깭留?媛깆떊?섍퀬 移대뱶 ?쒖꽌??怨좎젙 (isActive ?섏씠?쇱씠?몃쭔 蹂寃? */
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
      console.error("[Replay] 濡쒓렇 濡쒕뱶 ?ㅽ뙣", e)
      setGameOver(true)
    }
  }, [gameId])

  const handleReplayRestart = useCallback(() => {
    const init = replayInitialStateRef.current
    const evs = replayEventsRef.current
    if (!init || !evs.length) return
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
        // ?쇱슫???섏씠利???대㉧??state_snapshot?먯꽌留?諛섏쁺 (???ъ깮 ???쇱튂?쒗궎湲?
        const events = battleStateToEvents(bs)
        eventQueueRef.current?.enqueueAll(events)
        setQueueTick((t) => t + 1)
      }

      // round_end??state_update??battleStateToEvents?먯꽌 ?대? ?먯뿉 ?ы븿?섏뼱 ?쒖꽌媛 蹂댁옣??(蹂꾨룄 enqueue ????
      if (event.type === "round_end") {
        // no-op: collect/round??state_snapshot 泥섎━ ??諛섏쁺??
      }

      if (event.type === "game_end") {
        lastGameEndRef.current = { winner_id: event.winner_id ?? null, results: event.results }
        eventQueueRef.current?.enqueue(
          gameEndToEvent(event.winner_id ?? null, event.results)
        )
        setQueueTick((t) => t + 1)
        // 諛깆뿏?쒕뒗 ?대? 醫낅즺?쇰룄 ?꾨줎?몃뒗 ???쒖감 ?ъ깮???앸궇 ?뚭퉴吏 ?좎?. 寃뚯엫 醫낅즺???먯뿉??game_end 泥섎━ ??諛섏쁺.
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

  // ?먯뿉??game_end 泥섎━ ?쒖뿉留?寃뚯엫 醫낅즺쨌WS ?곌껐 ?댁젣 (?쒖감 ?ъ깮 ?앷퉴吏 ?좎?)
  useEffect(() => {
    if (!gameOver) return
    wsRef.current?.disconnect()
    wsRef.current = null
    setGameFinished(true)
  }, [gameOver])

  // URL???replay=1 ?닿퀬 寃뚯엫???대? 醫낅즺??寃쎌슦 由ы뵆?덉씠 ?먮룞 ?쒖옉
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
              {/* ?쒓퀎諛⑺뼢: ?좉났(0) ????1) ???고븯(2) ??醫뚰븯(3). 2?됱? 醫뚯슦 援먯껜 so [0,1,3,2] */}
              <div className="grid grid-cols-2 gap-60">
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
                        battleUiPositions={BATTLE_UI_POSITIONS}
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

