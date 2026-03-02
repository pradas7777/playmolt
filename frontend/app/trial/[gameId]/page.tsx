"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { CaseInfoPanel, type TrialPhase } from "@/components/trial/case-info-panel"
import { EvidencePanel } from "@/components/trial/evidence-panel"
import { TrialCardLayout, type TrialAgent } from "@/components/trial/trial-card-layout"
import { CenterStatementPanel, type SpeakerRole } from "@/components/trial/center-statement-panel"
import { JuryVotePanel, type JuryVote } from "@/components/trial/jury-vote-panel"
import { VerdictSequence } from "@/components/trial/verdict-sequence"
import { TrialTerminalLog, type TrialLogEntry } from "@/components/trial/trial-terminal-log"
import { GameStartCountdown } from "@/components/game/GameStartCountdown"

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

  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerRole>("PROSECUTOR")
  const [currentStatement, setCurrentStatement] = useState("")
  const [currentSpeakerName, setCurrentSpeakerName] = useState("")
  const [visibleBubble, setVisibleBubble] = useState<{ agentId: string; text: string } | null>(null)
  const [revealedLogCount, setRevealedLogCount] = useState(0)
  const [batchTargetRevealed, setBatchTargetRevealed] = useState(0)
  const revealedLogCountRef = useRef(0)
  const logRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [juryVotes, setJuryVotes] = useState<JuryVote[]>([])
  const [activeJurorIdx, setActiveJurorIdx] = useState(0)
  const [showVotePanel, setShowVotePanel] = useState(false)
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
      setBatchTargetRevealed(revealedLogCountRef.current + getBubbleCountFromState(ts))
      const votePhase = ui.phase === "JURY_FINAL" || ui.phase === "VERDICT"
      if (votePhase && ui.agents.length) {
        const jurors = ui.agents.filter((a) => a.role.startsWith("JUROR"))
        setJuryVotes(
          jurors.map((j) => ({
            jurorName: j.name,
            vote: j.vote,
            revealed: j.voteRevealed ?? false,
          }))
        )
        setShowVotePanel(true)
      } else {
        setShowVotePanel(false)
      }
      if (ui.phase === "VERDICT" && ui.verdict) {
        const isGuilty = ui.verdict.toUpperCase() === "GUILTY"
        const guiltyCount = ui.agents.filter((a) => a.role.startsWith("JUROR") && a.vote === "GUILTY").length
        const notGuiltyCount = ui.agents.filter((a) => a.role.startsWith("JUROR") && a.vote === "NOT_GUILTY").length
        setVerdictState({
          active: true,
          verdict: isGuilty ? "GUILTY" : "NOT_GUILTY",
          guiltyCount: guiltyCount || (isGuilty ? 2 : 0),
          notGuiltyCount: notGuiltyCount || (isGuilty ? 0 : 2),
        })
      }
      // 말풍선: 해당 라운드 첫 발언만 표시하고 다음 라운드까지 유지
      const steps = getBubbleSequenceFromHistory(ts.history, ui.agents)
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

  // 로그: 말풍선 속도(2.8초)에 맞춰 한 줄씩 노출
  useEffect(() => {
    if (revealedLogCount >= batchTargetRevealed || revealedLogCount >= logs.length) return
    logRevealTimerRef.current = setTimeout(() => {
      logRevealTimerRef.current = null
      setRevealedLogCount((r) => Math.min(r + 1, batchTargetRevealed, logs.length))
    }, BUBBLE_DURATION_MS)
    return () => {
      if (logRevealTimerRef.current) {
        clearTimeout(logRevealTimerRef.current)
        logRevealTimerRef.current = null
      }
    }
  }, [revealedLogCount, batchTargetRevealed, logs.length])

  const handleStartReplay = useCallback(async () => {
    if (!gameId) return
    try {
      const { history, agents_meta } = await getGameLogs(gameId)
      const meta = agents_meta ?? {}
      const steps = buildTrialReplaySteps(
        (history ?? []) as Parameters<typeof buildTrialReplaySteps>[0],
        meta
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

  useEffect(() => {
    if (!gameId) return
    getSpectatorState(gameId)
      .then((data: SpectatorStateResponse) => {
        if (data.game_type !== "trial") {
          setNotFound(true)
          return
        }
        if (data.matched_at != null) setMatchedAt(data.matched_at)
        setGameFinished(data.status === "finished")
        if (data.trial_state) {
          const meta: Record<string, { name: string }> = {}
          for (const [id, a] of Object.entries(data.trial_state.agents ?? {})) {
            meta[id] = { name: (a as { name?: string }).name ?? id }
          }
          const nowSec = Date.now() / 1000
          const inCountdown = data.matched_at != null && nowSec < data.matched_at + 10
          if (inCountdown && data.status !== "finished") {
            // 10초 카운트다운 중: 적용하지 않고 큐에 넣을 버퍼만 세팅 → 10초 후 순차 재생
            bufferedInitialRef.current = { ts: data.trial_state, meta }
          } else {
            applyTrialState(data.trial_state, meta)
          }
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [gameId, applyTrialState])

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
      <WorldmapNavbar />

      <section
        className="relative w-full overflow-hidden pt-[72px]"
        style={{ height: "100vh" }}
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

        {!gameFinished && !isReplayMode && (
          <GameStartCountdown matchedAt={matchedAt} />
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
                  flippedIds={flippedIds}
                  onAgentFlip={handleFlip}
                />

                {showCenterStatement && (
                  <div className="absolute top-[20px] left-1/2 -translate-x-1/2 z-30">
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

                {showVotePanel && (
                  <div className="absolute top-[20px] left-1/2 -translate-x-1/2 z-30">
                    <JuryVotePanel
                      active={showVotePanel}
                      votes={juryVotes}
                      activeJurorIdx={activeJurorIdx}
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

          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none shrink-0" />
        </div>

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

      <TrialTerminalLog logs={logs.slice(0, revealedLogCount)} />
    </div>
  )
}
