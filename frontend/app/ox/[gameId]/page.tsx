"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion } from "motion/react"
import Image from "next/image"
import { GameBackToWorldmap } from "@/components/game/game-back-to-worldmap"
import { OXRoundInfoPanel, type OXPhase } from "@/components/ox/round-info-panel"
import { OXMainPanel, type OXAgent } from "@/components/ox/ox-main-panel"
import { SwitchTimeBanner } from "@/components/ox/switch-time-banner"
import { MonopolyEffect } from "@/components/ox/monopoly-effect"
import { OXTerminalLog, type OXLogEntry } from "@/components/ox/ox-terminal-log"
import { getSpectatorState, getGameLogs, type OXState, type SpectatorStateResponse } from "@/lib/api/games"
import { GameWebSocket } from "@/lib/api/websocket"
import { mapOXStateToUI, mapOXHistoryToLogs, buildOXReplaySteps } from "@/lib/game/oxMapper"
import { OXEventQueue } from "@/lib/game/oxEventQueue"
import type { OXQueueItem } from "@/lib/game/oxEventQueue"
import { DistributionBar } from "@/components/ox/distribution-bar"
import { GameStartCountdown } from "@/components/game/GameStartCountdown"
import { WaitingAgentsPanel } from "@/components/game/waiting-agents-panel"

const OX_PHASE_TIMEOUT_SEC = 30
const SWITCH_TIME_SEC = 10
/** RESULT 진입 후 카드 이동 모션만 재생하는 대기 시간(이동 끝난 뒤 오버레이) */
const SWITCH_MOVE_DURATION_MS = 2500
const OVERLAY_DURATION_MS = 2500
const REVEAL_AGENT_DELAY_MS = 550
const REVEAL_SCORE_PANEL_WAIT_MS = 600

export default function OXSpectatorPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const gameId = typeof params.gameId === "string" ? params.gameId : ""

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [gameFinished, setGameFinished] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const [round, setRound] = useState(0)
  const [maxRound] = useState(5)
  const [phase, setPhase] = useState<OXPhase>("QUESTION_OPEN")
  const [question, setQuestion] = useState("")
  const [agents, setAgents] = useState<OXAgent[]>([])
  const [logs, setLogs] = useState<OXLogEntry[]>([])
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(null)
  const [switchCountdown, setSwitchCountdown] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [winnerName, setWinnerName] = useState("")
  const [monopoly, setMonopoly] = useState<{ active: boolean; agentName: string; points: number }>({
    active: false,
    agentName: "",
    points: 0,
  })

  const [isReplayMode, setReplayMode] = useState(false)
  const [replaySteps, setReplaySteps] = useState<OXState[]>([])
  const [replayStepIndex, setReplayStepIndex] = useState(0)
  const [replayAgentsMeta, setReplayAgentsMeta] = useState<Record<string, { name: string }>>({})

  const [showScorePanelOverlay, setShowScorePanelOverlay] = useState(false)
  const [resultOverlayStep, setResultOverlayStep] = useState<"switch_announce" | "final_result" | "points" | null>(null)
  const [resultOverlaySwitched, setResultOverlaySwitched] = useState(false)
  const [resultOverlayRound, setResultOverlayRound] = useState(0)
  /** 해당 라운드 소수측에게 지급된 포인트 (점수 획득 화면에서 +Npt 표시용) */
  const [lastResultRoundInfo, setLastResultRoundInfo] = useState<{ minority: string; pointsAwarded: number } | null>(null)
  /** 매칭 시각(Unix 초). 10초 카운트다운 후 큐 진행 */
  const [matchedAt, setMatchedAt] = useState<number | null>(null)
  const [waitingAgents, setWaitingAgents] = useState<{ id: string; name: string }[]>([])
  const [gameStatus, setGameStatus] = useState<string>("waiting")

  const wsRef = useRef<GameWebSocket | null>(null)
  const matchedAtRef = useRef<number | null>(null)
  const bufferedInitialRef = useRef<{ os: OXState; meta: Record<string, { name: string }> } | null>(null)
  const bufferedUpdatesRef = useRef<OXQueueItem[]>([])
  const countdownFlushScheduledRef = useRef(false)
  const agentsRef = useRef<OXAgent[]>([])
  const replayAutoStartedRef = useRef(false)
  const revealPhaseStartedAtRef = useRef<number>(0)
  const lastPhaseRef = useRef<string>("")
  const oxQueueRef = useRef<OXEventQueue | null>(null)
  const applyOXStateRef = useRef<(os: OXState | undefined, meta?: Record<string, { name: string }>, onMonopoly?: (name: string, pts: number) => void) => void>(() => {})
  const handleMonopolyRef = useRef<(name: string, pts: number) => void>(() => {})
  const [, setQueueTick] = useState(0)
  agentsRef.current = agents

  const applyOXState = useCallback(
    (
      os: OXState | undefined,
      agentsMeta?: Record<string, { name: string }>,
      onMonopoly?: (agentName: string, points: number) => void
    ) => {
      if (!os) return
      const ui = mapOXStateToUI(os)
      setRound(ui.round)
      setPhase(ui.phase)
      setQuestion(ui.question)
      setAgents(ui.agents)
      setPhaseStartedAt(ui.phaseStartedAt)
      if (os.history?.length && agentsMeta) {
        setLogs(mapOXHistoryToLogs(os.history, agentsMeta))
      }
      if (os.phase === "final_result" && os.history?.length) {
        const last = os.history[os.history.length - 1] as {
          minority?: string | null
          points_awarded?: number
        }
        const minority = last.minority
        const pointsAwarded = last.points_awarded ?? 0
        if (minority) {
          setLastResultRoundInfo({ minority, pointsAwarded })
        }
        if (onMonopoly && minority && pointsAwarded > 0 && os.agents) {
          const agentsWithMinority = Object.entries(os.agents).filter(
            ([, a]) => (a.final_choice ?? a.first_choice) === minority
          )
          if (agentsWithMinority.length === 1) {
            const [id, a] = agentsWithMinority[0]
            const name = (a as { name?: string }).name ?? agentsMeta?.[id]?.name ?? id
            onMonopoly(name, pointsAwarded)
          }
        }
      } else if (os.phase !== "final_result") {
        setLastResultRoundInfo(null)
      }
    },
    []
  )
  applyOXStateRef.current = applyOXState

  const handleMonopoly = useCallback((agentName: string, points: number) => {
    setMonopoly({ active: true, agentName, points })
    setTimeout(() => setMonopoly((prev) => ({ ...prev, active: false })), 4000)
  }, [])
  handleMonopolyRef.current = handleMonopoly

  const handleStartReplay = useCallback(async () => {
    if (!gameId) return
    try {
      const data = await getGameLogs(gameId)
      if (data.game_type !== "ox") return
      const history = (data.history ?? []) as import("@/lib/api/games").OXHistoryEntry[]
      const meta = data.agents_meta ?? {}
      const steps = buildOXReplaySteps(history, meta)
      if (!steps.length) return
      setReplayAgentsMeta(meta)
      setReplaySteps(steps)
      setReplayStepIndex(0)
      setGameOver(false)
      setReplayMode(true)
      applyOXState(steps[0], meta, handleMonopoly)
      setLogs(mapOXHistoryToLogs(steps[0].history, meta))
    } catch (e) {
      console.error("[OX Replay] 로그 로드 실패", e)
    }
  }, [gameId, applyOXState, handleMonopoly])

  const handleReplayPrev = useCallback(() => {
    setReplayStepIndex((i) => Math.max(0, i - 1))
  }, [])
  const handleReplayNext = useCallback(() => {
    setReplayStepIndex((i) => Math.min(replaySteps.length - 1, i + 1))
  }, [replaySteps.length])
  const handleReplayRestart = useCallback(() => {
    setReplayStepIndex(0)
    if (replaySteps[0]) {
      applyOXState(replaySteps[0], replayAgentsMeta, handleMonopoly)
      setLogs(mapOXHistoryToLogs(replaySteps[0].history, replayAgentsMeta))
    }
  }, [replaySteps, replayAgentsMeta, applyOXState, handleMonopoly])

  // Initial load: getSpectatorState
  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    getSpectatorState(gameId)
      .then((data: SpectatorStateResponse) => {
        if (cancelled) return
        if (data.game_type !== "ox") {
          setNotFound(true)
          return
        }
        if (data.matched_at != null) setMatchedAt(data.matched_at)
        setWaitingAgents(data.waiting_agents ?? [])
        setGameStatus(data.status)
        setGameFinished(data.status === "finished")
        if (data.status === "finished") {
          if (!searchParams.get("replay")) setGameOver(true)
          const winnerId = (data as { winner_id?: string }).winner_id
          const agentsMap = data.ox_state?.agents ?? {}
          const winnerAgent = winnerId ? (agentsMap[winnerId] as { name?: string } | undefined) : undefined
          setWinnerName(winnerAgent?.name ?? (winnerId ?? ""))
        }
        const meta: Record<string, { name: string }> = {}
        Object.entries(data.ox_state?.agents || {}).forEach(([id, a]) => {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        })
        applyOXState(data.ox_state, meta, handleMonopoly)
        if (data.ox_state?.history?.length) {
          setLogs(mapOXHistoryToLogs(data.ox_state.history, meta))
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameId, applyOXState, searchParams, handleMonopoly])

  // Replay: apply step when index changes; final_result 스텝이면 점수획득 오버레이(switch_announce → final_result → points) 트리거
  useEffect(() => {
    if (!isReplayMode || !replaySteps.length) return
    const step = replaySteps[replayStepIndex]
    if (step) {
      applyOXState(step, replayAgentsMeta, handleMonopoly)
      setLogs(mapOXHistoryToLogs(step.history, replayAgentsMeta))
      if (step.phase === "final_result") {
        setResultOverlayRound(step.round ?? 1)
        const anySwitched = Object.values(step.agents ?? {}).some(
          (a: { switch_used?: boolean }) => a?.switch_used
        )
        setResultOverlaySwitched(!!anySwitched)
        setResultOverlayStep("switch_announce")
      } else {
        setResultOverlayStep(null)
      }
    }
  }, [isReplayMode, replaySteps, replayStepIndex, replayAgentsMeta, applyOXState, handleMonopoly])

  // ?replay=1 and game finished: auto-start replay once
  useEffect(() => {
    if (!gameId || !searchParams.get("replay") || !gameFinished || loading || replayAutoStartedRef.current) return
    replayAutoStartedRef.current = true
    handleStartReplay()
  }, [gameId, gameFinished, loading, searchParams, handleStartReplay])

  matchedAtRef.current = matchedAt

  // 매칭 후 10초 경과 시 버퍼 플러시 (initial + state_update 순서대로 큐에 넣기)
  useEffect(() => {
    if (matchedAt == null || countdownFlushScheduledRef.current) return
    const nowSec = Date.now() / 1000
    const delayMs = (matchedAt + 10 - nowSec) * 1000
    if (delayMs <= 0) {
      const init = bufferedInitialRef.current
      const updates = bufferedUpdatesRef.current
      bufferedInitialRef.current = null
      bufferedUpdatesRef.current = []
      if (init) {
        applyOXStateRef.current?.(init.os, init.meta, handleMonopolyRef.current ?? undefined)
        oxQueueRef.current?.enqueue({ type: "ox_state", ox_state: init.os, agentsMeta: init.meta })
      }
      updates.forEach((item) => oxQueueRef.current?.enqueue(item))
      setQueueTick((t) => t + 1)
      countdownFlushScheduledRef.current = true
      return
    }
    countdownFlushScheduledRef.current = true
    const t = setTimeout(() => {
      const init = bufferedInitialRef.current
      const updates = bufferedUpdatesRef.current
      bufferedInitialRef.current = null
      bufferedUpdatesRef.current = []
      if (init) {
        applyOXStateRef.current?.(init.os, init.meta, handleMonopolyRef.current ?? undefined)
        oxQueueRef.current?.enqueue({ type: "ox_state", ox_state: init.os, agentsMeta: init.meta })
      }
      updates.forEach((item) => oxQueueRef.current?.enqueue(item))
      setQueueTick((s) => s + 1)
    }, delayMs)
    return () => clearTimeout(t)
  }, [matchedAt])

  // OX 실시간 큐: state_update는 큐에만 넣고 순차 적용 (배틀과 동일)
  useEffect(() => {
    const q = new OXEventQueue({
      onApplyState: (item) => {
        applyOXStateRef.current?.(item.ox_state, item.agentsMeta, handleMonopolyRef.current ?? undefined)
      },
      onGameEnd: (item) => {
        setGameOver(true)
        const results = item.results ?? []
        const winner = results.find((r) => r.rank === 1)
        const name = winner ? agentsRef.current.find((a) => a.id === winner.agent_id)?.name : undefined
        setWinnerName(name ?? (winner?.agent_id ?? ""))
        setGameFinished(true)
      },
      onQueueEmpty: () => setQueueTick((t) => t + 1),
    })
    oxQueueRef.current = q
    return () => {
      q.clear()
      oxQueueRef.current = null
    }
  }, [])

  // WebSocket: initial은 직접 적용, state_update/game_end는 큐에만 넣기
  useEffect(() => {
    if (!gameId || gameFinished || isReplayMode) return
    const ws = new GameWebSocket()
    wsRef.current = ws
    ws.connect(gameId, (event) => {
      if (event.type === "error") {
        if (event.detail === "game_not_found") {
          router.replace("/ox")
          return
        }
        setReconnecting(true)
        return
      }
      setReconnecting(false)

      const nowSec = Date.now() / 1000
      const inCountdown =
        matchedAtRef.current != null && nowSec < matchedAtRef.current + 10

      if (event.type === "initial" && event.ox_state) {
        const os = event.ox_state as OXState
        const meta: Record<string, { name: string }> = {}
        Object.entries(os.agents || {}).forEach(([id, a]) => {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        })
        if (inCountdown) {
          bufferedInitialRef.current = { os, meta }
        } else {
          applyOXStateRef.current?.(os, meta, handleMonopolyRef.current ?? undefined)
          oxQueueRef.current?.enqueue({ type: "ox_state", ox_state: os, agentsMeta: meta })
          setQueueTick((t) => t + 1)
        }
      }
      if (event.type === "state_update" && event.ox_state) {
        const os = event.ox_state as OXState
        const meta: Record<string, { name: string }> = {}
        Object.entries(os.agents || {}).forEach(([id, a]) => {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        })
        const item: OXQueueItem = { type: "ox_state", ox_state: os, agentsMeta: meta }
        if (inCountdown) {
          bufferedUpdatesRef.current.push(item)
        } else {
          oxQueueRef.current?.enqueue(item)
          setQueueTick((t) => t + 1)
        }
      }
      if (event.type === "game_end") {
        const item: OXQueueItem = {
          type: "game_end",
          winner_id: event.winner_id ?? null,
          results: event.results as { agent_id: string; rank: number }[] | undefined,
        }
        if (inCountdown) {
          bufferedUpdatesRef.current.push(item)
        } else {
          oxQueueRef.current?.enqueue(item)
          setQueueTick((t) => t + 1)
        }
      }
    })
    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [gameId, gameFinished, isReplayMode, router])

  useEffect(() => {
    if (notFound) router.replace("/ox")
  }, [notFound, router])

  // Switch phase: 라운드별 10초. 전원 이미 스위치 사용했으면 0(스킵)
  useEffect(() => {
    if (phase !== "SWITCH_TIME" || phaseStartedAt == null) {
      setSwitchCountdown(0)
      return
    }
    const allUsedSwitch = agents.length > 0 && agents.every((a) => !a.switchAvailable)
    const tick = () => {
      if (allUsedSwitch) {
        setSwitchCountdown(0)
        return
      }
      const remaining = Math.max(0, Math.ceil(phaseStartedAt + SWITCH_TIME_SEC - Date.now() / 1000))
      setSwitchCountdown(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, phaseStartedAt, agents])

  // REVEAL 진입 시: 에이전트 이동 대기 → 스코어 패널 2.5초 표시. (백엔드가 곧바로 switch로 넘어가도 클라이언트에서 타이머로 표시 유지)
  useEffect(() => {
    if (isReplayMode) return
    if (phase !== "REVEAL") {
      lastPhaseRef.current = phase
      return
    }
    if (lastPhaseRef.current === "REVEAL") return
    lastPhaseRef.current = "REVEAL"
    const agentCount = Math.max(1, agents.length)
    const totalWait = agentCount * REVEAL_AGENT_DELAY_MS + REVEAL_SCORE_PANEL_WAIT_MS
    const t1 = setTimeout(() => {
      setShowScorePanelOverlay(true)
      revealPhaseStartedAtRef.current = Date.now()
    }, totalWait)
    return () => clearTimeout(t1)
  }, [phase, agents.length, isReplayMode])
  useEffect(() => {
    if (!showScorePanelOverlay) return
    const t = setTimeout(() => setShowScorePanelOverlay(false), OVERLAY_DURATION_MS)
    return () => clearTimeout(t)
  }, [showScorePanelOverlay])

  // RESULT 진입: 카드 이동 모션만 재생(플립 없음). 이동 끝난 뒤 switch_announce → 점수 화면
  useEffect(() => {
    if (isReplayMode) return
    if (phase === "RESULT" && resultOverlayRound !== round) {
      setResultOverlayRound(round)
      setResultOverlaySwitched(agents.some((a) => a.switched))
      const hasSwitched = agents.some((a) => a.switched)
      if (!hasSwitched) {
        setResultOverlayStep("switch_announce")
      } else {
        const t = setTimeout(() => setResultOverlayStep("switch_announce"), SWITCH_MOVE_DURATION_MS)
        return () => clearTimeout(t)
      }
    }
    if (phase !== "RESULT") setResultOverlayStep(null)
  }, [phase, round, agents, resultOverlayRound, isReplayMode])

  // RESULT 오버레이 단계: switch_announce → final_result → points
  useEffect(() => {
    if (resultOverlayStep === null) return
    const t = setTimeout(() => {
      if (resultOverlayStep === "switch_announce") setResultOverlayStep("final_result")
      else if (resultOverlayStep === "final_result") setResultOverlayStep("points")
      else setResultOverlayStep(null)
    }, OVERLAY_DURATION_MS)
    return () => clearTimeout(t)
  }, [resultOverlayStep])

  const handleFlip = useCallback((id: string) => {
    setFlippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-mono text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (notFound) {
    return null
  }

  return (
    <div className="relative min-h-screen bg-background">
      <GameBackToWorldmap />
      <section
        className="relative w-full overflow-hidden pt-12"
        style={{ height: "100dvh", minHeight: "100svh" }}
      >
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <Image
            src="/images/ox-area.jpg"
            alt="OX Beach"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40" />
        </motion.div>

        {!gameFinished && matchedAt == null && (
          <WaitingAgentsPanel
            agents={waitingAgents}
            visible={gameStatus === "waiting" && waitingAgents.length > 0}
          />
        )}
        {!gameFinished && <GameStartCountdown matchedAt={matchedAt} waitingAgents={waitingAgents} />}

        {phase === "SWITCH_TIME" && switchCountdown > 0 && (
          <div className="absolute inset-0 z-20 bg-black/30 pointer-events-none" />
        )}

        <div className="relative z-10 flex flex-col h-full">
          <div className="pt-3 pb-2">
            <OXRoundInfoPanel
              round={round}
              maxRound={maxRound}
              phase={phase}
              question={question}
            />
          </div>
          <SwitchTimeBanner
            active={phase === "SWITCH_TIME" && switchCountdown > 0}
            countdown={switchCountdown}
          />
          <div className="flex-1 flex items-start justify-center mt-10 sm:mt-16">
            <OXMainPanel
              agents={agents}
              phase={phase}
              onAgentFlip={handleFlip}
              flippedIds={flippedIds}
            />
          </div>
          <div className="h-8 sm:h-10 flex-shrink-0 shrink-0 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        <MonopolyEffect
          active={monopoly.active}
          agentName={monopoly.agentName}
          points={monopoly.points}
        />

        {/* REVEAL 후 스코어 패널 오버레이 (이동 대기 → 2.5초 표시, phase가 이미 switch여도 유지) */}
        {showScorePanelOverlay && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl border border-white/20 bg-black/80 px-8 py-6 max-w-md w-full mx-4"
            >
              <p className="text-center text-white/80 text-sm font-mono mb-4">Round {round} · OX 스코어</p>
              <DistributionBar
                oCount={agents.filter((a) => a.choice === "O").length}
                xCount={agents.filter((a) => a.choice === "X").length}
                total={agents.length}
              />
              <div className="mt-4 flex justify-center gap-6 text-xs font-mono text-white/70">
                {agents.slice(0, 5).map((a) => (
                  <span key={a.id}>{a.name}: {a.points}pt</span>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        {/* RESULT 단계: 스위치 발동 → 최종 결과 → 점수 획득 (각 2.5초, 실시간·리플레이 공통) */}
        {resultOverlayStep !== null && phase === "RESULT" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            {resultOverlayStep === "switch_announce" && (
              <motion.div
                key="switch"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl border border-yellow-400/50 bg-yellow-500/20 px-10 py-8 text-center"
              >
                <p className="text-2xl font-black text-yellow-200 font-mono">
                  {resultOverlaySwitched ? "스위치 발동!" : "스위치 발동 없음!"}
                </p>
              </motion.div>
            )}
            {resultOverlayStep === "final_result" && (
              <motion.div
                key="final"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl border border-white/20 bg-black/80 px-8 py-6 max-w-md w-full mx-4"
              >
                <p className="text-center text-white font-mono font-bold mb-4">최종 결과</p>
                <DistributionBar
                  oCount={agents.filter((a) => a.choice === "O").length}
                  xCount={agents.filter((a) => a.choice === "X").length}
                  total={agents.length}
                />
              </motion.div>
            )}
            {resultOverlayStep === "points" && (
              <motion.div
                key="points"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl border border-emerald-400/50 bg-emerald-500/20 px-8 py-6 max-w-md w-full mx-4"
              >
                <p className="text-center text-emerald-200 font-mono font-bold mb-4">점수 획득</p>
                <div className="space-y-2">
                  {[...agents]
                    .sort((a, b) => b.points - a.points)
                    .map((a) => {
                      const roundPoints =
                        lastResultRoundInfo && a.choice === lastResultRoundInfo.minority
                          ? lastResultRoundInfo.pointsAwarded
                          : 0
                      return (
                        <div
                          key={a.id}
                          className="flex justify-between items-center text-sm font-mono text-white/90"
                        >
                          <span>{a.name}</span>
                          <span>
                            {roundPoints > 0 ? `+${roundPoints}pt` : "0pt"}
                            <span className="text-white/60 ml-1">(총 {a.points}pt)</span>
                          </span>
                        </div>
                      )
                    })}
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* 리플레이 컨트롤: 게임 화면(section) 안 하단 고정 */}
        {isReplayMode && replaySteps.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-3 shadow-xl">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReplayRestart}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
              >
                ⏮ 처음부터
              </button>
              <button
                type="button"
                onClick={handleReplayPrev}
                disabled={replayStepIndex <= 0}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                ◀ 이전
              </button>
              <button
                type="button"
                onClick={handleReplayNext}
                disabled={replayStepIndex >= replaySteps.length - 1}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                다음 ▶
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-white/10 overflow-hidden max-w-[200px]">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${replaySteps.length ? ((replayStepIndex + 1) / replaySteps.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-[11px] font-mono text-white/70">
                {replayStepIndex + 1} / {replaySteps.length}
              </span>
            </div>
          </div>
        )}
      </section>

      <OXTerminalLog logs={logs} />

      {gameOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl border border-border bg-card p-8 text-center max-w-sm">
            <h2 className="text-xl font-bold text-foreground mb-2">게임 종료</h2>
            <p className="text-muted-foreground mb-4">{winnerName ? `${winnerName} 승리!` : "종료"}</p>
            {gameFinished && (
              <a
                href={`/ox/${gameId}?replay=1`}
                className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
              >
                다시보기
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
