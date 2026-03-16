"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { GameBackToWorldmap } from "@/components/game/game-back-to-worldmap"
import { CaseInfoPanel, type TrialPhase } from "@/components/trial/case-info-panel"
import { EvidencePanel } from "@/components/trial/evidence-panel"
import { TrialCardLayout, type TrialAgent } from "@/components/trial/trial-card-layout"
import { CenterStatementPanel, type SpeakerRole } from "@/components/trial/center-statement-panel"
import { JuryVotePanel, type JuryVote } from "@/components/trial/jury-vote-panel"
import { VerdictSequence } from "@/components/trial/verdict-sequence"
import { TrialTerminalLog, type TrialLogEntry } from "@/components/trial/trial-terminal-log"
import { GameStartCountdown } from "@/components/game/GameStartCountdown"
import { WaitingAgentsPanel } from "@/components/game/waiting-agents-panel"

import {
  getSpectatorState,
  getGameLogs,
  type TrialState,
  type SpectatorStateResponse,
} from "@/lib/api/games"
import { GameWebSocket } from "@/lib/api/websocket"
import {
  mapTrialStateToUI,
  mapTrialHistoryToLogs,
  buildTrialReplaySteps,
  getBubbleSequenceFromHistory,
  getJuryVerdictBubblesFromHistory,
  getBubbleCountFromState,
} from "@/lib/game/trialMapper"
import { TrialEventQueue } from "@/lib/game/trialEventQueue"

const BUBBLE_DURATION_MS = 2800

export default function TrialSpectatorPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const gameId = typeof params.gameId === "string" ? params.gameId : ""

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [gameFinished, setGameFinished] = useState(false)
  const [isReplayMode, setReplayMode] = useState(false)
  const [replaySteps, setReplaySteps] = useState<TrialState[]>([])
  const [replayStepIndex, setReplayStepIndex] = useState(0)
  const [replayAgentsMeta, setReplayAgentsMeta] = useState<Record<string, { name: string }>>({})
  const replayAutoStartedRef = useRef(false)

  const [phase, setPhase] = useState<TrialPhase>("OPENING")
  const [caseTitle, setCaseTitle] = useState("")
  const [caseDescription, setCaseDescription] = useState("")
  const [agents, setAgents] = useState<TrialAgent[]>([])
  const [logs, setLogs] = useState<TrialLogEntry[]>([])
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())
  const [verdict, setVerdict] = useState<string | null>(null)
  const [winnerTeam, setWinnerTeam] = useState<string | null>(null)
  const [matchedAt, setMatchedAt] = useState<number | null>(null)
  const [waitingAgents, setWaitingAgents] = useState<{ id: string; name: string }[]>([])
  const [gameStatus, setGameStatus] = useState<string>("waiting")

  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerRole>("PROSECUTOR")
  const [currentStatement, setCurrentStatement] = useState("")
  const [currentSpeakerName, setCurrentSpeakerName] = useState("")
  const [visibleBubble, setVisibleBubble] = useState<{ agentId: string; text: string } | null>(null)
  const [bubbleSteps, setBubbleSteps] = useState<{ agentId: string; text: string }[]>([])
  const [bubbleIndex, setBubbleIndex] = useState(0)
  const [fixedBubbles, setFixedBubbles] = useState<Record<string, string>>({})
  const lastRoundKeyRef = useRef<string>("")
  const [revealedLogCount, setRevealedLogCount] = useState(0)
  const [displayLogs, setDisplayLogs] = useState<TrialLogEntry[]>([])
  const [batchTargetRevealed, setBatchTargetRevealed] = useState(0)
  const revealedLogCountRef = useRef(0)
  const displayLogsLengthRef = useRef(0)
  const logRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [juryVotes, setJuryVotes] = useState<JuryVote[]>([])
  const [activeJurorIdx, setActiveJurorIdx] = useState(0)
  const [showVotePanel, setShowVotePanel] = useState(false)
  const [verdictPrepStep, setVerdictPrepStep] = useState<"bubbles" | "vote_reveal" | "done" | null>(null)
  const verdictDataRef = useRef<{
    verdict: "GUILTY" | "NOT_GUILTY"
    guiltyCount: number
    notGuiltyCount: number
  } | null>(null)
  const [verdictState, setVerdictState] = useState<{
    active: boolean
    verdict: "GUILTY" | "NOT_GUILTY"
    guiltyCount: number
    notGuiltyCount: number
  }>({ active: false, verdict: "GUILTY", guiltyCount: 0, notGuiltyCount: 0 })

  const wsRef = useRef<GameWebSocket | null>(null)
  const matchedAtRef = useRef<number | null>(null)
  const bufferedInitialRef = useRef<{ ts: TrialState; meta: Record<string, { name: string }> } | null>(null)
  const bufferedUpdatesRef = useRef<TrialState[]>([])
  const countdownFlushScheduledRef = useRef(false)
  const trialQueueRef = useRef<TrialEventQueue | null>(null)
  const applyTrialStateRef = useRef<
    (ts: TrialState | undefined, agentsMeta?: Record<string, { name: string }>) => void
  >(() => {})

  const applyTrialState = useCallback(
    (ts: TrialState | undefined, agentsMeta?: Record<string, { name: string }>) => {
      if (!ts) return
      const ui = mapTrialStateToUI(ts, agentsMeta)
      setPhase(ui.phase)
      setCaseTitle(ui.caseTitle)
      setCaseDescription(ui.caseDescription)
      setVerdict(ui.verdict)
      setWinnerTeam(ui.winnerTeam)
      const fullLogs = ts.history?.length && agentsMeta
        ? mapTrialHistoryToLogs(ts.history, agentsMeta)
        : ui.logs
      setLogs(fullLogs)
      if (fullLogs.length < displayLogsLengthRef.current) {
        setDisplayLogs([])
        setRevealedLogCount(0)
        revealedLogCountRef.current = 0
        displayLogsLengthRef.current = 0
      }
      setBatchTargetRevealed(revealedLogCountRef.current + getBubbleCountFromState(ts))

      const votePhase = ui.phase === "VERDICT"
      const jurors = ui.agents
        .filter((a) => a.role.startsWith("JUROR"))
        .sort((a, b) => {
          const order = ["JUROR_1", "JUROR_2", "JUROR_3"] as const
          return order.indexOf(a.role as (typeof order)[number]) - order.indexOf(b.role as (typeof order)[number])
        })

      if (ui.phase === "VERDICT" && ui.verdict) {
        const isGuilty = ui.verdict.toUpperCase() === "GUILTY"
        const guiltyCount = ui.agents.filter((a) => a.role.startsWith("JUROR") && a.vote === "GUILTY").length
        const notGuiltyCount = ui.agents.filter((a) => a.role.startsWith("JUROR") && a.vote === "NOT_GUILTY").length
        verdictDataRef.current = {
          verdict: isGuilty ? "GUILTY" : "NOT_GUILTY",
          guiltyCount: guiltyCount || (isGuilty ? 2 : 0),
          notGuiltyCount: notGuiltyCount || (isGuilty ? 0 : 2),
        }
        const juryBubbles = getJuryVerdictBubblesFromHistory(ts.history, ui.agents)
        setVerdictPrepStep("bubbles")
        setBubbleSteps(juryBubbles)
        setBubbleIndex(0)
        setJuryVotes(
          jurors.map((j) => ({
            jurorName: j.name,
            vote: j.vote ?? null,
            revealed: false,
          }))
        )
        setShowVotePanel(false)
        setActiveJurorIdx(0)
        setVerdictState((prev) => ({ ...prev, active: false }))
      } else {
        setVerdictPrepStep(null)
        verdictDataRef.current = null
        if (votePhase && ui.agents.length) {
          setJuryVotes(
            jurors.map((j) => ({
              jurorName: j.name,
              vote: j.vote ?? null,
              revealed: j.voteRevealed ?? false,
            }))
          )
          setShowVotePanel(true)
        } else {
          setShowVotePanel(false)
        }
        setVerdictState((prev) => ({ ...prev, active: false }))
      }

      const steps =
        ui.phase === "VERDICT"
          ? getJuryVerdictBubblesFromHistory(ts.history, ui.agents)
          : getBubbleSequenceFromHistory(ts.history, ui.agents)

      const roundKey = `${ui.phase}-${ts.history?.length ?? 0}`
      if (roundKey !== lastRoundKeyRef.current) {
        lastRoundKeyRef.current = roundKey
        setFixedBubbles({})
      }

      setBubbleSteps(steps)
      setBubbleIndex(0)
      const first = steps[0]
      setAgents(
        ui.agents.map((a) => ({
          ...a,
          isSpeaking: first ? a.id === first.agentId : false,
        }))
      )
      if (first) {
        setVisibleBubble({ agentId: first.agentId, text: first.text })
      } else {
        setVisibleBubble(null)
      }
    },
    []
  )

  applyTrialStateRef.current = applyTrialState

  revealedLogCountRef.current = revealedLogCount

  // 말풍선 순차 재생: bubbleIndex를 BUBBLE_DURATION_MS 간격으로 증가
  useEffect(() => {
    if (bubbleSteps.length === 0) {
      if (verdictPrepStep === "bubbles") {
        setVerdictPrepStep("vote_reveal")
        setShowVotePanel(true)
        setActiveJurorIdx(0)
      }
      return
    }
    if (bubbleIndex >= bubbleSteps.length) return

    const current = bubbleSteps[bubbleIndex]

    const isJuryVotePhase =
      phase === "JURY_INTERIM" || phase === "JURY_FINAL"

    // 배심원 투표 관련 단계에서는,
    // - JURY_INTERIM / JURY_FINAL: 1번, 2번, 3번 순서대로 누적해서 화면에 남김
    // - verdictPrepStep === "bubbles": 최종 투표 말풍선도 동일하게 누적
    if (isJuryVotePhase || verdictPrepStep === "bubbles") {
      setFixedBubbles((prev) => ({
        ...prev,
        [current.agentId]: current.text,
      }))
    }

    setVisibleBubble({ agentId: current.agentId, text: current.text })
    setAgents((prev) =>
      prev.map((a) => ({
        ...a,
        isSpeaking: a.id === current.agentId,
      }))
    )
    // 말풍선 표시 시간:
    // - 일반 phase: 고정 BUBBLE_DURATION_MS
    // - 배심원 투표/최종 투표 말풍선: 텍스트 길이에 비례해서 더 길게 유지 (타자 효과가 끝날 때까지)
    const bubbleDuration =
      verdictPrepStep === "bubbles" || isJuryVotePhase
        ? Math.max(BUBBLE_DURATION_MS, current.text.length * 40 + 400)
        : BUBBLE_DURATION_MS

    if (bubbleIndex >= bubbleSteps.length - 1) {
      // 일반 phase 에서는 마지막에 그 phase 발언들을 모두 고정 말풍선으로 남긴다.
      // 배심원 투표 관련 단계에서는 위에서 이미 누적했으므로 추가 누적은 하지 않는다.
      if (!isJuryVotePhase && verdictPrepStep !== "bubbles") {
        setFixedBubbles((prev) => ({
          ...prev,
          ...Object.fromEntries(bubbleSteps.map((s) => [s.agentId, s.text])),
        }))
      }
      if (verdictPrepStep === "bubbles") {
        const t = setTimeout(() => {
          setVerdictPrepStep("vote_reveal")
          setShowVotePanel(true)
          setActiveJurorIdx(0)
        }, bubbleDuration)
        return () => clearTimeout(t)
      }
      return
    }
    const t = setTimeout(() => setBubbleIndex((i) => i + 1), bubbleDuration)
    return () => clearTimeout(t)
  }, [bubbleSteps, bubbleIndex, verdictPrepStep])

  // 배심원 판결 준비: vote_reveal 단계에서 순차적으로 유무죄 공개
  const VOTE_REVEAL_DURATION_MS = 1800
  useEffect(() => {
    if (verdictPrepStep !== "vote_reveal" || juryVotes.length === 0) return
    const maxIdx = juryVotes.length - 1
    setJuryVotes((prev) =>
      prev.map((v, i) => ({
        ...v,
        revealed: i <= activeJurorIdx && v.vote != null,
      }))
    )
    if (activeJurorIdx > maxIdx) {
      setVerdictPrepStep("done")
      const data = verdictDataRef.current
      if (data) {
        setVerdictState({
          active: true,
          verdict: data.verdict,
          guiltyCount: data.guiltyCount,
          notGuiltyCount: data.notGuiltyCount,
        })
      }
      return
    }
    const t = setTimeout(() => setActiveJurorIdx((i) => i + 1), VOTE_REVEAL_DURATION_MS)
    return () => clearTimeout(t)
  }, [verdictPrepStep, activeJurorIdx, juryVotes.length])

  // 로그: 말풍선 속도(2.8초)에 맞춰 한 줄씩 노출, 노출 시점에 타임스탬프 기록
  useEffect(() => {
    if (revealedLogCount >= batchTargetRevealed || revealedLogCount >= logs.length) return
    logRevealTimerRef.current = setTimeout(() => {
      logRevealTimerRef.current = null
      const nextIdx = revealedLogCount
      const nextEntry = logs[nextIdx]
      const ts = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      if (nextEntry) {
        setDisplayLogs((prev) => {
          const next = [...prev, { ...nextEntry, timestamp: ts }]
          displayLogsLengthRef.current = next.length
          return next
        })
      }
      setRevealedLogCount((r) => Math.min(r + 1, batchTargetRevealed, logs.length))
    }, BUBBLE_DURATION_MS)
    return () => {
      if (logRevealTimerRef.current) {
        clearTimeout(logRevealTimerRef.current)
        logRevealTimerRef.current = null
      }
    }
  }, [revealedLogCount, batchTargetRevealed, logs])

  const handleStartReplay = useCallback(async () => {
    if (!gameId) return
    try {
      const [logsRes, spectatorRes] = await Promise.all([
        getGameLogs(gameId),
        getSpectatorState(gameId),
      ])
      const { history, agents_meta } = logsRes
      const meta = agents_meta ?? {}
      const baseState = spectatorRes.trial_state
        ? {
            case: spectatorRes.trial_state.case,
            expansion: spectatorRes.trial_state.expansion,
          }
        : undefined
      const steps = buildTrialReplaySteps(
        (history ?? []) as Parameters<typeof buildTrialReplaySteps>[0],
        meta,
        baseState
      )
      setReplayAgentsMeta(meta)
      setReplaySteps(steps)
      setReplayStepIndex(0)
      setReplayMode(true)
      if (steps[0]) applyTrialState(steps[0], meta)
    } catch (e) {
      console.error("[Trial Replay] 로그 로드 실패", e)
    }
  }, [gameId, applyTrialState])

  useEffect(() => {
    trialQueueRef.current = new TrialEventQueue({
      onApplyState: (item) =>
        applyTrialStateRef.current(item.trial_state, item.agentsMeta),
    })
    return () => {
      trialQueueRef.current?.clear()
      trialQueueRef.current = null
    }
  }, [])

  const hasReplayQuery = !!searchParams.get("replay")
  useEffect(() => {
    if (!gameId) return
    getSpectatorState(gameId)
      .then((data: SpectatorStateResponse) => {
        if (data.game_type !== "trial") {
          setNotFound(true)
          return
        }
        if (data.matched_at != null) setMatchedAt(data.matched_at)
        setWaitingAgents(data.waiting_agents ?? [])
        setGameStatus(data.status)
        setGameFinished(data.status === "finished")
        if (data.trial_state) {
          const meta: Record<string, { name: string }> = {}
          for (const [id, a] of Object.entries(data.trial_state.agents ?? {})) {
            meta[id] = { name: (a as { name?: string }).name ?? id }
          }
          const nowSec = Date.now() / 1000
          const inCountdown = data.matched_at != null && nowSec < data.matched_at + 10
          const skipInitialApply = data.status === "finished" && hasReplayQuery
          if (inCountdown && data.status !== "finished") {
            bufferedInitialRef.current = { ts: data.trial_state, meta }
          } else if (!skipInitialApply) {
            applyTrialState(data.trial_state, meta)
          }
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [gameId, applyTrialState, hasReplayQuery])

  useEffect(() => {
    if (!isReplayMode || !replaySteps.length) return
    const step = replaySteps[replayStepIndex]
    if (step) applyTrialState(step, replayAgentsMeta)
  }, [isReplayMode, replaySteps, replayStepIndex, replayAgentsMeta, applyTrialState])

  useEffect(() => {
    if (
      !gameId ||
      !searchParams.get("replay") ||
      !gameFinished ||
      loading ||
      replayAutoStartedRef.current
    )
      return
    replayAutoStartedRef.current = true
    handleStartReplay()
  }, [gameId, gameFinished, loading, searchParams, handleStartReplay])

  matchedAtRef.current = matchedAt

  useEffect(() => {
    if (matchedAt == null || countdownFlushScheduledRef.current) return
    const nowSec = Date.now() / 1000
    const delayMs = (matchedAt + 10 - nowSec) * 1000
    if (delayMs <= 0) {
      const init = bufferedInitialRef.current
      const updates = bufferedUpdatesRef.current
      bufferedInitialRef.current = null
      bufferedUpdatesRef.current = []
      const q = trialQueueRef.current
      if (init) q?.enqueue({ type: "trial_state", trial_state: init.ts, agentsMeta: init.meta, bubbleCount: getBubbleCountFromState(init.ts) })
      updates.forEach((ts) => q?.enqueue({ type: "trial_state", trial_state: ts, bubbleCount: getBubbleCountFromState(ts) }))
      countdownFlushScheduledRef.current = true
      return
    }
    countdownFlushScheduledRef.current = true
    const t = setTimeout(() => {
      const init = bufferedInitialRef.current
      const updates = bufferedUpdatesRef.current
      bufferedInitialRef.current = null
      bufferedUpdatesRef.current = []
      const q = trialQueueRef.current
      if (init) q?.enqueue({ type: "trial_state", trial_state: init.ts, agentsMeta: init.meta, bubbleCount: getBubbleCountFromState(init.ts) })
      updates.forEach((ts) => q?.enqueue({ type: "trial_state", trial_state: ts, bubbleCount: getBubbleCountFromState(ts) }))
    }, delayMs)
    return () => clearTimeout(t)
  }, [matchedAt])

  useEffect(() => {
    if (!gameId || gameFinished || isReplayMode) return
    const ws = new GameWebSocket()
    wsRef.current = ws
    ws.connect(gameId, (event) => {
      if (event.type === "error") {
        if (event.detail === "game_not_found") {
          router.replace("/trial")
          return
        }
        return
      }

      const nowSec = Date.now() / 1000
      const inCountdown =
        matchedAtRef.current != null && nowSec < matchedAtRef.current + 10

      if (event.type === "initial" && event.trial_state) {
        const ts = event.trial_state as TrialState
        const meta: Record<string, { name: string }> = {}
        for (const [id, a] of Object.entries(ts.agents ?? {})) {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        }
        if (inCountdown) {
          bufferedInitialRef.current = { ts, meta }
        } else {
          trialQueueRef.current?.enqueue({
            type: "trial_state",
            trial_state: ts,
            agentsMeta: meta,
            bubbleCount: getBubbleCountFromState(ts),
          })
        }
      }
      if (event.type === "state_update" && event.trial_state) {
        const ts = event.trial_state as TrialState
        const meta: Record<string, { name: string }> = {}
        for (const [id, a] of Object.entries(ts.agents ?? {})) {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        }
        if (inCountdown) {
          bufferedUpdatesRef.current.push(ts)
        } else {
          trialQueueRef.current?.enqueue({
            type: "trial_state",
            trial_state: ts,
            agentsMeta: meta,
            bubbleCount: getBubbleCountFromState(ts),
          })
        }
      }
    })
    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [gameId, gameFinished, isReplayMode, router])

  useEffect(() => {
    if (notFound) router.replace("/trial")
  }, [notFound, router])

  const handleFlip = useCallback((id: string) => {
    setFlippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const isArgumentPhase =
    phase === "ARGUMENT_1" ||
    phase === "ARGUMENT_2" ||
    phase === "JUDGE_EXPAND"
  const argumentRoundNum = phase === "ARGUMENT_1" ? 1 : phase === "ARGUMENT_2" ? 2 : 1
  const showCenterStatement =
    phase !== "JURY_VOTE" && phase !== "JURY_FINAL" && phase !== "VERDICT"
  const prosecutor = agents.find((a) => a.role === "PROSECUTOR")
  const defense = agents.find((a) => a.role === "DEFENSE")

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-mono text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (notFound) return null

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
            src="/images/trial-court-bg.jpg"
            alt="Molt Trial Court"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/45" />
        </motion.div>

        {!gameFinished && !isReplayMode && matchedAt == null && (
          <WaitingAgentsPanel
            agents={waitingAgents}
            visible={gameStatus === "waiting" && waitingAgents.length > 0}
          />
        )}
        {!gameFinished && !isReplayMode && (
          <GameStartCountdown matchedAt={matchedAt} waitingAgents={waitingAgents} />
        )}

        <AnimatePresence>
          {(phase === "JURY_FINAL" || phase === "VERDICT") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.2 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-indigo-900 pointer-events-none"
            />
          )}
        </AnimatePresence>

        <div className="relative z-10 flex flex-col h-full">
          <div className="pt-3 pb-2 px-4">
            <CaseInfoPanel
              caseTitle={caseTitle || "사건 정보 로딩 중"}
              caseDescription={caseDescription}
              phase={phase}
              round={1}
              maxRound={10}
            />
          </div>

          <div className="flex-1 flex items-center justify-center relative px-2 overflow-hidden">
            <div className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-30">
              <EvidencePanel
                side="prosecution"
                evidenceFor={prosecutor?.evidenceFor ?? []}
                evidenceAgainst={prosecutor?.evidenceAgainst ?? []}
                visible={isArgumentPhase}
              />
            </div>

            <div className="flex flex-col items-center gap-2 w-full max-w-[1000px]">
              <div className="relative w-full">
                <TrialCardLayout
                  agents={agents}
                  phase={phase}
                  currentSpeaker={currentSpeaker}
                  visibleBubble={visibleBubble}
                  fixedBubbles={fixedBubbles}
                  flippedIds={flippedIds}
                  onAgentFlip={handleFlip}
                />

                {showCenterStatement && !isReplayMode && (
                  <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-20">
                    <CenterStatementPanel
                      currentSpeaker={currentSpeaker}
                      speakerName={currentSpeakerName || "—"}
                      statement={currentStatement}
                      argumentRound={argumentRoundNum}
                      totalRounds={2}
                      phaseLabel={phase.replace(/_/g, " ")}
                      visible
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30">
              <EvidencePanel
                side="defense"
                evidenceFor={defense?.evidenceFor ?? []}
                evidenceAgainst={defense?.evidenceAgainst ?? []}
                visible={isArgumentPhase}
              />
            </div>
          </div>

          <div className="h-8 sm:h-10 flex-shrink-0 shrink-0 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        {showVotePanel && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-end pr-4 sm:pr-8">
            <div className="pointer-events-auto w-full max-w-[360px]">
              <JuryVotePanel
                active={showVotePanel}
                votes={juryVotes}
                activeJurorIdx={activeJurorIdx}
              />
            </div>
          </div>
        )}

        <VerdictSequence
          active={verdictState.active}
          verdict={verdictState.verdict}
          guiltyCount={verdictState.guiltyCount}
          notGuiltyCount={verdictState.notGuiltyCount}
          prosecutorName={prosecutor?.name ?? "검사"}
          defenseName={defense?.name ?? "변호사"}
          points={0}
          onDismiss={() =>
            setVerdictState((prev) => ({ ...prev, active: false }))
          }
        />

        {isReplayMode && replaySteps.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-3 shadow-xl">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setReplayStepIndex(0)
                  if (replaySteps[0])
                    applyTrialState(replaySteps[0], replayAgentsMeta)
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
              >
                ⏮ 처음부터
              </button>
              <button
                type="button"
                onClick={() =>
                  setReplayStepIndex((i) => Math.max(0, i - 1))
                }
                disabled={replayStepIndex <= 0}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                ◀ 이전
              </button>
              <button
                type="button"
                onClick={() =>
                  setReplayStepIndex((i) =>
                    Math.min(replaySteps.length - 1, i + 1)
                  )
                }
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
                    width: `${
                      replaySteps.length
                        ? ((replayStepIndex + 1) / replaySteps.length) * 100
                        : 0
                    }%`,
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

      <TrialTerminalLog logs={displayLogs} />
    </div>
  )
}
