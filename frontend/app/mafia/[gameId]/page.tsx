"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { MafiaRoundInfo, type MafiaPhase } from "@/components/mafia/mafia-round-info"
import { MafiaCardGrid } from "@/components/mafia/mafia-card-grid"
import { VotePanel, type VoteTally } from "@/components/mafia/vote-panel"
import { RevealSequence } from "@/components/mafia/reveal-sequence"
import { MafiaTerminalLog, type MafiaLogEntry } from "@/components/mafia/mafia-terminal-log"
import { GameStartCountdown } from "@/components/game/GameStartCountdown"

import { getSpectatorState, getGameLogs, type MafiaState, type SpectatorStateResponse } from "@/lib/api/games"
import { GameWebSocket } from "@/lib/api/websocket"
import { mapMafiaStateToUI, mapMafiaHistoryToLogs, buildMafiaReplaySteps } from "@/lib/game/mafiaMapper"
import { MafiaEventQueue } from "@/lib/game/mafiaEventQueue"

export default function MafiaSpectatorPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const gameId = typeof params.gameId === "string" ? params.gameId : ""

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [gameFinished, setGameFinished] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const [isReplayMode, setReplayMode] = useState(false)
  const [replaySteps, setReplaySteps] = useState<MafiaState[]>([])
  const [replayStepIndex, setReplayStepIndex] = useState(0)
  const [replayAgentsMeta, setReplayAgentsMeta] = useState<Record<string, { name: string }>>({})
  const replayAutoStartedRef = useRef(false)

  const [round, setRound] = useState(1)
  const [maxRound] = useState(5)
  const [phase, setPhase] = useState<MafiaPhase>("WORD_ASSIGNED")
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof mapMafiaStateToUI>>["agents"]>([])
  const [logs, setLogs] = useState<MafiaLogEntry[]>([])
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())
  const [citizenWord, setCitizenWord] = useState<string | null>(null)
  const [wolfWord, setWolfWord] = useState<string | null>(null)
  const [showVotePanel, setShowVotePanel] = useState(false)
  const [voteTallies, setVoteTallies] = useState<VoteTally[]>([])
  const [revealState, setRevealState] = useState<{
    active: boolean
    eliminatedName: string
    eliminatedRole: "WOLF" | "SHEEP"
  }>({ active: false, eliminatedName: "", eliminatedRole: "SHEEP" })
  const [eliminatedId, setEliminatedId] = useState<string | null>(null)
  const [voteDetail, setVoteDetail] = useState<{ voter_id: string; target_id: string; reason?: string }[]>([])
  const [voteDisplayPhase, setVoteDisplayPhase] = useState<"arrows" | "result">("result")
  const [matchedAt, setMatchedAt] = useState<number | null>(null)
  const [visibleBubbles, setVisibleBubbles] = useState<Record<string, string>>({})
  const [speakingAgentId, setSpeakingAgentId] = useState<string | null>(null)

  const wsRef = useRef<GameWebSocket | null>(null)
  const matchedAtRef = useRef<number | null>(null)
  const bufferedInitialRef = useRef<{ ms: MafiaState; meta: Record<string, { name: string }> } | null>(null)
  const bufferedUpdatesRef = useRef<MafiaState[]>([])
  const countdownFlushScheduledRef = useRef(false)
  const mafiaQueueRef = useRef<MafiaEventQueue | null>(null)
  const applyMafiaStateRef = useRef<(ms: MafiaState | undefined, agentsMeta?: Record<string, { name: string }>) => void>(() => {})
  const lastPlayedHintRef = useRef<string>("")
  const bubbleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const applyMafiaState = useCallback((ms: MafiaState | undefined, agentsMeta?: Record<string, { name: string }>) => {
    if (!ms) return
    const ui = mapMafiaStateToUI(ms, agentsMeta)
    setRound(ui.round)
    setPhase(ui.phase)
    setAgents(ui.agents)
    setCitizenWord(ui.citizenWord)
    setWolfWord(ui.wolfWord)
    setVoteDetail(ui.voteDetail ?? [])
    if (ms.history?.length && agentsMeta) {
      setLogs(mapMafiaHistoryToLogs(ms.history, agentsMeta))
    }
    if (ui.phase === "REVEAL" && ui.eliminatedId) {
      setEliminatedId(ui.eliminatedId)
      const name = ui.agents.find((a) => a.id === ui.eliminatedId)?.name ?? ui.eliminatedId
      setRevealState({
        active: false,
        eliminatedName: name,
        eliminatedRole: (ui.eliminatedRole === "WOLF" ? "WOLF" : "SHEEP") as "WOLF" | "SHEEP",
      })
      setShowVotePanel(false)
      const detail = ui.voteDetail ?? []
      const tallyMap = new Map<string, { votes: number; voters: string[] }>()
      for (const row of detail) {
        const targetName = ui.agents.find((a) => a.id === row.target_id)?.name ?? row.target_id
        const voterName = ui.agents.find((a) => a.id === row.voter_id)?.name ?? row.voter_id
        const cur = tallyMap.get(targetName) ?? { votes: 0, voters: [] }
        cur.votes += 1
        cur.voters.push(voterName)
        tallyMap.set(targetName, cur)
      }
      const tallies: VoteTally[] = ui.agents.map((a) => ({
        agentName: a.name,
        votes: tallyMap.get(a.name)?.votes ?? 0,
        voters: tallyMap.get(a.name)?.voters ?? [],
      }))
      setVoteTallies(tallies)
    } else {
      setShowVotePanel(false)
    }
  }, [])

  applyMafiaStateRef.current = applyMafiaState

  const handleStartReplay = useCallback(async () => {
    if (!gameId) return
    try {
      const { history, agents_meta } = await getGameLogs(gameId)
      const meta = agents_meta ?? {}
      const steps = buildMafiaReplaySteps(
        (history ?? []) as Parameters<typeof buildMafiaReplaySteps>[0],
        meta
      )
      setReplayAgentsMeta(meta)
      setReplaySteps(steps)
      setReplayStepIndex(0)
      setReplayMode(true)
      if (steps[0]) applyMafiaState(steps[0], meta)
    } catch (e) {
      console.error("[Mafia Replay] 로그 로드 실패", e)
    }
  }, [gameId, applyMafiaState])

  useEffect(() => {
    mafiaQueueRef.current = new MafiaEventQueue({
      onApplyState: (item) => applyMafiaStateRef.current(item.mafia_state, item.agentsMeta),
    })
    return () => {
      bubbleTimersRef.current.forEach((t) => clearTimeout(t))
      bubbleTimersRef.current = []
      mafiaQueueRef.current?.clear()
      mafiaQueueRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!gameId) return
    getSpectatorState(gameId)
      .then((data: SpectatorStateResponse) => {
        if (data.game_type !== "mafia") {
          setNotFound(true)
          return
        }
        if (data.matched_at != null) setMatchedAt(data.matched_at)
        setGameFinished(data.status === "finished")
        if (data.mafia_state) {
          const meta: Record<string, { name: string }> = {}
          for (const [id, a] of Object.entries(data.mafia_state.agents ?? {})) {
            meta[id] = { name: (a as { name?: string }).name ?? id }
          }
          applyMafiaState(data.mafia_state, meta)
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [gameId, applyMafiaState])

  useEffect(() => {
    if (!isReplayMode || !replaySteps.length) return
    const step = replaySteps[replayStepIndex]
    if (step) applyMafiaState(step, replayAgentsMeta)
  }, [isReplayMode, replaySteps, replayStepIndex, replayAgentsMeta, applyMafiaState])

  useEffect(() => {
    if (!gameId || !searchParams.get("replay") || !gameFinished || loading || replayAutoStartedRef.current) return
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
      const q = mafiaQueueRef.current
      if (init) q?.enqueue({ type: "mafia_state", mafia_state: init.ms, agentsMeta: init.meta })
      updates.forEach((ms) => q?.enqueue({ type: "mafia_state", mafia_state: ms }))
      countdownFlushScheduledRef.current = true
      return
    }
    countdownFlushScheduledRef.current = true
    const t = setTimeout(() => {
      const init = bufferedInitialRef.current
      const updates = bufferedUpdatesRef.current
      bufferedInitialRef.current = null
      bufferedUpdatesRef.current = []
      const q = mafiaQueueRef.current
      if (init) q?.enqueue({ type: "mafia_state", mafia_state: init.ms, agentsMeta: init.meta })
      updates.forEach((ms) => q?.enqueue({ type: "mafia_state", mafia_state: ms }))
    }, delayMs)
    return () => clearTimeout(t)
  }, [matchedAt])

  const hintPhases: MafiaPhase[] = ["HINT_ROUND_1", "HINT_ROUND_2", "HINT_ROUND_3"]

  useEffect(() => {
    if (phase === "REVEAL" && voteDetail.length > 0) setVoteDisplayPhase("arrows")
    else setVoteDisplayPhase("result")
  }, [phase, voteDetail.length])

  useEffect(() => {
    if (voteDisplayPhase !== "arrows" || phase !== "REVEAL" || voteDetail.length === 0) return
    const delayMs = voteDetail.length * 600 + 2500
    const t = setTimeout(() => setVoteDisplayPhase("result"), delayMs)
    return () => clearTimeout(t)
  }, [voteDisplayPhase, phase, voteDetail.length])

  useEffect(() => {
    if (voteDisplayPhase === "result" && phase === "REVEAL") {
      setShowVotePanel(true)
      setRevealState((prev) => (prev.eliminatedName ? { ...prev, active: true } : prev))
    }
  }, [voteDisplayPhase, phase])

  useEffect(() => {
    bubbleTimersRef.current.forEach((t) => clearTimeout(t))
    bubbleTimersRef.current = []
    setVisibleBubbles({})
    setSpeakingAgentId(null)
    lastPlayedHintRef.current = ""
  }, [phase])

  useEffect(() => {
    if (!hintPhases.includes(phase) || agents.length === 0) return
    if (lastPlayedHintRef.current === phase) return
    lastPlayedHintRef.current = phase
    const roundIndex = phase === "HINT_ROUND_1" ? 0 : phase === "HINT_ROUND_2" ? 1 : 2
    const HINT_BUBBLE_MS = 800
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      const hintText = (agent.hints?.[roundIndex] ?? "") as string
      timers.push(
        setTimeout(() => {
          setVisibleBubbles((prev) => ({ ...prev, [agent.id]: hintText }))
          setSpeakingAgentId(agent.id)
        }, i * HINT_BUBBLE_MS)
      )
    }
    timers.push(
      setTimeout(() => setSpeakingAgentId(null), agents.length * HINT_BUBBLE_MS)
    )
    bubbleTimersRef.current = timers
    // phase 변경 시에만 타이머 정리(위 phase effect). 여기서 cleanup 시 리렌더마다 타이머가 취소됨.
    return () => {}
  }, [phase, agents])

  useEffect(() => {
    if (!gameId || gameFinished || isReplayMode) return
    const ws = new GameWebSocket()
    wsRef.current = ws
    ws.connect(gameId, (event) => {
      if (event.type === "error") {
        if (event.detail === "game_not_found") {
          router.replace("/mafia")
          return
        }
        setReconnecting(true)
        return
      }
      setReconnecting(false)

      const nowSec = Date.now() / 1000
      const inCountdown = matchedAtRef.current != null && nowSec < matchedAtRef.current + 10

      if (event.type === "initial" && event.mafia_state) {
        const ms = event.mafia_state as MafiaState
        const meta: Record<string, { name: string }> = {}
        for (const [id, a] of Object.entries(ms.agents ?? {})) {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        }
        if (inCountdown) {
          bufferedInitialRef.current = { ms, meta }
        } else {
          mafiaQueueRef.current?.enqueue({ type: "mafia_state", mafia_state: ms, agentsMeta: meta })
        }
      }
      if (event.type === "state_update" && event.mafia_state) {
        const ms = event.mafia_state as MafiaState
        const meta: Record<string, { name: string }> = {}
        for (const [id, a] of Object.entries(ms.agents ?? {})) {
          meta[id] = { name: (a as { name?: string }).name ?? id }
        }
        if (inCountdown) {
          bufferedUpdatesRef.current.push(ms)
        } else {
          mafiaQueueRef.current?.enqueue({ type: "mafia_state", mafia_state: ms, agentsMeta: meta })
        }
      }
    })
    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [gameId, gameFinished, isReplayMode, router, applyMafiaState])

  useEffect(() => {
    if (notFound) router.replace("/mafia")
  }, [notFound, router])

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

  if (notFound) return null

  return (
    <div className="relative min-h-screen bg-background">
      <WorldmapNavbar />

      <section className="relative w-full overflow-hidden pt-[72px]" style={{ height: "100vh" }}>
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <Image
            src="/images/mafia-camp-bg.jpg"
            alt="Mafia Camp"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/50" />
        </motion.div>

        {!gameFinished && !isReplayMode && <GameStartCountdown matchedAt={matchedAt} />}

        <AnimatePresence>
          {phase === "VOTE" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.2 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-red-900 pointer-events-none"
            />
          )}
        </AnimatePresence>

        <div className="relative z-10 flex flex-col h-full">
          <div className="pt-3 pb-2">
            <MafiaRoundInfo
              round={round}
              maxRound={maxRound}
              phase={phase}
              observerMode={true}
              wolfWord={wolfWord ?? undefined}
              sheepWord={citizenWord ?? undefined}
            />
          </div>

          <MafiaCardGrid
            agents={agents.map((a) => ({ ...a, isSpeaking: a.id === speakingAgentId }))}
            phase={phase}
            observerMode={true}
            visibleBubbles={visibleBubbles}
            voteDetail={voteDetail}
            flippedIds={flippedIds}
            onAgentFlip={handleFlip}
            eliminatedId={eliminatedId ?? undefined}
          />

          <VotePanel
            active={showVotePanel}
            tallies={voteTallies}
            totalVoters={agents.filter((a) => !a.eliminated).length}
          />

          <div className="h-12 bg-gradient-to-t from-background to-transparent pointer-events-none shrink-0" />
        </div>

        <RevealSequence
          active={revealState.active}
          eliminatedName={revealState.eliminatedName}
          eliminatedRole={revealState.eliminatedRole}
          wolfWord={wolfWord ?? "?"}
          sheepWord={citizenWord ?? "?"}
          onDismiss={() => setRevealState((prev) => ({ ...prev, active: false }))}
        />

        {isReplayMode && replaySteps.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-3 shadow-xl">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setReplayStepIndex(0)
                  if (replaySteps[0]) applyMafiaState(replaySteps[0], replayAgentsMeta)
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
              >
                ⏮ 처음부터
              </button>
              <button
                type="button"
                onClick={() => setReplayStepIndex((i) => Math.max(0, i - 1))}
                disabled={replayStepIndex <= 0}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                ◀ 이전
              </button>
              <button
                type="button"
                onClick={() => setReplayStepIndex((i) => Math.min(replaySteps.length - 1, i + 1))}
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

      <MafiaTerminalLog logs={logs} />
    </div>
  )
}
