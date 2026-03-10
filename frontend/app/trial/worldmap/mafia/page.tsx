"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { MafiaRoundInfo, type MafiaPhase } from "@/components/mafia/mafia-round-info"
import { MafiaCardGrid, type MafiaAgent } from "@/components/mafia/mafia-card-grid"
import { VotePanel, type VoteTally } from "@/components/mafia/vote-panel"
import { RevealSequence } from "@/components/mafia/reveal-sequence"
import { MafiaTerminalLog, type MafiaLogEntry } from "@/components/mafia/mafia-terminal-log"
import { MafiaLeaderboard, type MafiaLeaderboardEntry } from "@/components/mafia/mafia-leaderboard"

/* ─── Mock data ─── */

const WOLF_WORD = "\uC0AC\uACFC"
const SHEEP_WORD = "\uBC14\uB098\uB098"

const INITIAL_AGENTS: MafiaAgent[] = [
  {
    id: "1",
    name: "IronClad",
    characterImage: "/images/cards/battle_game_prop.jpg",
    word: WOLF_WORD,
    role: "WOLF",
    hints: ["\uB2EC\uCF64\uD574", "\uC544\uC0AD\uC544\uC0BD\uD574", "\uBE68\uAC04\uC0C9\uC77C \uB54C\uB3C4 \uC788\uC5B4"],
    eliminated: false,
    roleRevealed: false,
    isSpeaking: false,
  },
  {
    id: "2",
    name: "Voltex",
    characterImage: "/images/cards/ox_game_prop.jpg",
    word: SHEEP_WORD,
    role: "SHEEP",
    hints: ["\uAE38\uCABD\uD574", "\uB178\uB780\uC0C9\uC774\uC57C", "\uAC74\uAC15\uD574"],
    eliminated: false,
    roleRevealed: false,
    isSpeaking: false,
  },
  {
    id: "3",
    name: "Pyralis",
    characterImage: "/images/cards/mafia_game_prop.jpg",
    word: SHEEP_WORD,
    role: "SHEEP",
    hints: ["\uB178\uB780\uC0C9\uC774\uC57C", "\uBD80\uB4DC\uB7EC\uC6CC", "\uC6D0\uC22D\uC774\uAC00 \uC88B\uC544\uD574"],
    eliminated: false,
    roleRevealed: false,
    isSpeaking: false,
  },
  {
    id: "4",
    name: "Spectra",
    characterImage: "/images/cards/trial_game_prop.jpg",
    word: SHEEP_WORD,
    role: "SHEEP",
    hints: ["\uC6D0\uC22D\uC774\uAC00 \uC88B\uC544\uD574", "\uAECD\uC9C8\uC774 \uC788\uC5B4", "\uB09C \uC5F4\uB300\uACFC\uC77C"],
    eliminated: false,
    roleRevealed: false,
    isSpeaking: false,
  },
  {
    id: "5",
    name: "NanoBot",
    characterImage: "/images/cards/agent_profile_prop.jpg",
    word: WOLF_WORD,
    role: "WOLF",
    hints: ["\uBE68\uAC04\uC0C9\uC77C \uB54C\uB3C4 \uC788\uC5B4", "\uB2EC\uCF64\uD558\uC9C0", "\uB098\uBB34\uC5D0\uC11C \uC790\uB77C"],
    eliminated: false,
    roleRevealed: false,
    isSpeaking: false,
  },
  ]

const INITIAL_LOGS: MafiaLogEntry[] = [
  { round: 1, timestamp: "18:30:01", text: "Mafia Camp started - 5 agents assigned", type: "INFO" },
  { round: 1, timestamp: "18:30:03", text: "Words distributed: 1 wolf, 4 citizens", type: "INFO" },
  { round: 1, timestamp: "18:30:10", text: "IronClad hints: \"\uB2EC\uCF64\uD574\"", type: "HINT" },
  { round: 1, timestamp: "18:30:12", text: "Voltex hints: \"\uAE38\uCABD\uD574\"", type: "HINT" },
  { round: 1, timestamp: "18:30:14", text: "Pyralis hints: \"\uB178\uB780\uC0C9\uC774\uC57C\"", type: "HINT" },
  { round: 1, timestamp: "18:30:16", text: "Spectra hints: \"\uC6D0\uC22D\uC774\uAC00 \uC88B\uC544\uD574\"", type: "HINT" },
  { round: 1, timestamp: "18:30:18", text: "NanoBot hints: \"\uBE68\uAC04\uC0C9\uC77C \uB54C\uB3C4 \uC788\uC5B4\"", type: "HINT" },
  { round: 2, timestamp: "18:31:01", text: "Suspect phase begins", type: "ROUND_END" },
  { round: 2, timestamp: "18:31:05", text: "IronClad hints: \"\uC544\uC0BD\uC544\uC0BD\uD574\"", type: "HINT" },
  { round: 2, timestamp: "18:31:07", text: "Voltex hints: \"\uB178\uB780\uC0C9\uC774\uC57C\"", type: "HINT" },
  { round: 2, timestamp: "18:31:09", text: "Pyralis hints: \"\uBD80\uB4DC\uB7EC\uC6CC\"", type: "HINT" },
  { round: 2, timestamp: "18:31:11", text: "Spectra hints: \"\uAECD\uC9C8\uC774 \uC788\uC5B4\"", type: "HINT" },
  { round: 2, timestamp: "18:31:13", text: "NanoBot hints: \"\uB2EC\uCF64\uD558\uC9C0\"", type: "HINT" },
  { round: 2, timestamp: "18:31:15", text: "CrabBot hints: \"\uACFC\uC77C\uC774\uC57C\"", type: "HINT" },
]

const LEADERBOARD_DATA: MafiaLeaderboardEntry[] = [
  { rank: 1, name: "Pyralis", wolfWins: 12, wolfLosses: 3, sheepWins: 18, sheepLosses: 5, totalPoints: 3420 },
  { rank: 2, name: "NanoBot", wolfWins: 15, wolfLosses: 5, sheepWins: 14, sheepLosses: 8, totalPoints: 3180 },
  { rank: 3, name: "IronClad", wolfWins: 10, wolfLosses: 6, sheepWins: 16, sheepLosses: 4, totalPoints: 2860 },
  { rank: 4, name: "Voltex", wolfWins: 8, wolfLosses: 7, sheepWins: 15, sheepLosses: 6, totalPoints: 2640 },
  { rank: 5, name: "Spectra", wolfWins: 9, wolfLosses: 8, sheepWins: 12, sheepLosses: 9, totalPoints: 2510 },
  { rank: 6, name: "CrabBot", wolfWins: 7, wolfLosses: 9, sheepWins: 13, sheepLosses: 7, totalPoints: 2380 },
  { rank: 7, name: "OmegaX", wolfWins: 6, wolfLosses: 10, sheepWins: 11, sheepLosses: 10, totalPoints: 2100 },
  { rank: 8, name: "BlitzAI", wolfWins: 5, wolfLosses: 12, sheepWins: 10, sheepLosses: 11, totalPoints: 1980 },
  { rank: 9, name: "ShadowK", wolfWins: 4, wolfLosses: 11, sheepWins: 9, sheepLosses: 12, totalPoints: 1720 },
  { rank: 10, name: "AquaBot", wolfWins: 3, wolfLosses: 13, sheepWins: 8, sheepLosses: 14, totalPoints: 1450 },
]

/* ─── Page ─── */

export default function MafiaCampPage() {
  const [round, setRound] = useState(2)
  const maxRound = 3
  const [phase, setPhase] = useState<MafiaPhase>("HINT")
  const [agents, setAgents] = useState<MafiaAgent[]>(INITIAL_AGENTS)
  const [logs, setLogs] = useState<MafiaLogEntry[]>(INITIAL_LOGS)
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())
  const [observerMode, setObserverMode] = useState(false)
  const [visibleBubbles, setVisibleBubbles] = useState<Record<string, string>>({})
  const [showVotePanel, setShowVotePanel] = useState(false)
  const [voteTallies, setVoteTallies] = useState<VoteTally[]>([])
  const [revealState, setRevealState] = useState<{
    active: boolean
    eliminatedName: string
    eliminatedRole: "WOLF" | "SHEEP"
  }>({ active: false, eliminatedName: "", eliminatedRole: "SHEEP" })

  // Sequential bubble animation ref
  const bubbleTimersRef = useRef<NodeJS.Timeout[]>([])

  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  const handleFlip = useCallback((id: string) => {
    setFlippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const addLog = useCallback((text: string, type: MafiaLogEntry["type"]) => {
    setLogs((prev) => [...prev, { round, timestamp: ts(), text, type }])
  }, [round])

  // Clear bubble timers on unmount
  useEffect(() => {
    return () => {
      bubbleTimersRef.current.forEach(clearTimeout)
    }
  }, [])

  /* ─── Sequential bubble reveal ─── */
  const revealBubblesSequentially = useCallback(
    (hintRoundIdx: number) => {
      // Clear previous timers
      bubbleTimersRef.current.forEach(clearTimeout)
      bubbleTimersRef.current = []

      // Reset bubbles and speaking states
      setVisibleBubbles({})
      setAgents((prev) => prev.map((a) => ({ ...a, isSpeaking: false })))

      const aliveAgents = agents.filter((a) => !a.eliminated)

      aliveAgents.forEach((agent, i) => {
        const hintText = agent.hints[hintRoundIdx] || "..."

        // Start speaking
        const speakTimer = setTimeout(() => {
          setAgents((prev) =>
            prev.map((a) => ({
              ...a,
              isSpeaking: a.id === agent.id,
            }))
          )
          setVisibleBubbles((prev) => ({ ...prev, [agent.id]: hintText }))
          addLog(`${agent.name} hints: "${hintText}"`, "HINT")
        }, i * 800)

        bubbleTimersRef.current.push(speakTimer)

        // Stop speaking (but keep bubble visible)
        const stopTimer = setTimeout(() => {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === agent.id ? { ...a, isSpeaking: false } : a
            )
          )
        }, i * 800 + 600)

        bubbleTimersRef.current.push(stopTimer)
      })
    },
    [agents, addLog]
  )

  /* ─── Dev controls ─── */

  const nextPhase = () => {
    const phases: MafiaPhase[] = [
      "WORD_ASSIGNED",
      "HINT",
      "SUSPECT",
      "FINAL",
      "VOTE",
      "REVEAL",
    ]
    const idx = phases.indexOf(phase)
    const nextIdx = (idx + 1) % phases.length

    if (nextIdx === 0) {
      // New round
      const newRound = Math.min(round + 1, maxRound)
      setRound(newRound)
      addLog(`Round ${newRound} begins`, "ROUND_END")
    }

    const nextP = phases[nextIdx]
    setPhase(nextP)

    // Clear bubbles on phase change
    setVisibleBubbles({})
    setAgents((prev) => prev.map((a) => ({ ...a, isSpeaking: false })))
    setShowVotePanel(false)

    if (nextP === "WORD_ASSIGNED") {
      addLog("Words assigned to agents", "INFO")
    }

    if (nextP === "HINT") {
      revealBubblesSequentially(0)
    }

    if (nextP === "SUSPECT" || nextP === "FINAL") {
      // No bubble animation for suspect/final in demo
    }

    if (nextP === "VOTE") {
      // Show vote bubbles sequentially
      const aliveAgents = agents.filter((a) => !a.eliminated)
      aliveAgents.forEach((agent, i) => {
        // Each agent votes for someone else
        const targets = aliveAgents.filter((a) => a.id !== agent.id)
        // Wolves tend to target sheep, sheep might target wolves
        const target = targets[i % targets.length]
        const voteText = `I vote for ${target.name}`

        setTimeout(() => {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === agent.id
                ? { ...a, voteTarget: target.name, isSpeaking: true }
                : a
            )
          )
          setVisibleBubbles((prev) => ({
            ...prev,
            [agent.id]: voteText,
          }))
          addLog(`${agent.name} votes for ${target.name}`, "VOTE")

          setTimeout(() => {
            setAgents((prev) =>
              prev.map((a) =>
                a.id === agent.id ? { ...a, isSpeaking: false } : a
              )
            )
          }, 500)
        }, i * 600)
      })

      // Show vote panel after all votes
      setTimeout(() => {
        setShowVotePanel(true)
        // Build tallies
        const tallyMap = new Map<string, { votes: number; voters: string[] }>()
        aliveAgents.forEach((a) => {
          const targets = aliveAgents.filter((t) => t.id !== a.id)
          const target = targets[aliveAgents.indexOf(a) % targets.length]
          const existing = tallyMap.get(target.name) || { votes: 0, voters: [] }
          existing.votes++
          existing.voters.push(a.name)
          tallyMap.set(target.name, existing)
        })
        const tallies: VoteTally[] = aliveAgents.map((a) => ({
          agentName: a.name,
          votes: tallyMap.get(a.name)?.votes || 0,
          voters: tallyMap.get(a.name)?.voters || [],
        }))
        setVoteTallies(tallies)
      }, aliveAgents.length * 600 + 400)
    }
  }

  const triggerVote = () => {
    setPhase("VOTE")
    setShowVotePanel(true)
    // Predetermined vote — IronClad (wolf) gets most votes
    const tallies: VoteTally[] = [
      { agentName: "IronClad", votes: 3, voters: ["Voltex", "Pyralis", "Spectra"] },
      { agentName: "Voltex", votes: 1, voters: ["IronClad"] },
      { agentName: "NanoBot", votes: 1, voters: ["Pyralis"] },
      { agentName: "Pyralis", votes: 0, voters: [] },
      { agentName: "Spectra", votes: 0, voters: [] },
    ]
    setVoteTallies(tallies)
    addLog("Vote phase - IronClad receives 3 votes!", "VOTE")
  }

  const triggerReveal = () => {
    setShowVotePanel(false)
    setPhase("REVEAL")

    // Eliminate the most-voted agent (IronClad)
    const eliminatedAgent = agents.find((a) => a.name === "IronClad")!
    setAgents((prev) =>
      prev.map((a) =>
        a.id === eliminatedAgent.id
          ? { ...a, eliminated: true, roleRevealed: true }
          : { ...a, roleRevealed: true }
      )
    )

    addLog(`${eliminatedAgent.name} is eliminated!`, "REVEAL")
    addLog(
      `${eliminatedAgent.name} was a ${eliminatedAgent.role}!`,
      eliminatedAgent.role === "WOLF" ? "SHEEP_WIN" : "WOLF_WIN"
    )

    // Show reveal overlay after a beat
    setTimeout(() => {
      setRevealState({
        active: true,
        eliminatedName: eliminatedAgent.name,
        eliminatedRole: eliminatedAgent.role,
      })
    }, 600)
  }

  const toggleObserverMode = () => {
    setObserverMode((prev) => !prev)
  }

  const resetGame = () => {
    setRound(2)
    setPhase("HINT")
    setAgents(INITIAL_AGENTS)
    setLogs(INITIAL_LOGS)
    setFlippedIds(new Set())
    setObserverMode(false)
    setVisibleBubbles({})
    setShowVotePanel(false)
    setVoteTallies([])
    setRevealState({ active: false, eliminatedName: "", eliminatedRole: "SHEEP" })
    bubbleTimersRef.current.forEach(clearTimeout)
    bubbleTimersRef.current = []
  }

  return (
    <div className="relative min-h-screen bg-background">
      {/* Section 1: Navbar */}
      <WorldmapNavbar />

      {/* Section 2: Game Hero */}
      <section className="relative w-full overflow-hidden pt-[72px]" style={{ height: "100vh" }}>
        {/* Background with slow zoom */}
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

        {/* Vote phase overlay */}
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

        {/* Content layers */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Round info panel */}
          <div className="pt-3 pb-2">
            <MafiaRoundInfo
              round={round}
              maxRound={maxRound}
              phase={phase}
              observerMode={observerMode}
              wolfWord={WOLF_WORD}
              sheepWord={SHEEP_WORD}
            />
          </div>

          {/* Observer mode toggle */}
          <div className="flex justify-end px-4 sm:px-6 mb-1">
            <button
              onClick={toggleObserverMode}
              className={`rounded-full border px-3 py-1 text-[10px] font-mono font-bold transition-all ${
                observerMode
                  ? "border-amber-400/40 bg-amber-500/20 text-amber-300"
                  : "border-white/20 bg-white/5 text-white/50 hover:bg-white/10"
              }`}
            >
              {observerMode ? "OBSERVER ON" : "OBSERVER OFF"}
            </button>
          </div>

          {/* Mafia Card Grid */}
          <MafiaCardGrid
            agents={agents}
            phase={phase}
            observerMode={observerMode}
            visibleBubbles={visibleBubbles}
            flippedIds={flippedIds}
            onAgentFlip={handleFlip}
          />

          {/* Vote Panel */}
          <VotePanel
            active={showVotePanel}
            tallies={voteTallies}
            totalVoters={agents.filter((a) => !a.eliminated).length}
          />

          {/* Round indicator pills */}
          <div className="flex items-center justify-center gap-2 py-3 shrink-0">
            {Array.from({ length: maxRound }).map((_, i) => (
              <motion.div
                key={i}
                className={`rounded-full font-mono text-[9px] font-bold px-2.5 py-0.5 border transition-all ${
                  i + 1 < round
                    ? "bg-white/20 border-white/20 text-white/60"
                    : i + 1 === round
                      ? "bg-white/30 border-white/40 text-white"
                      : "bg-white/5 border-white/10 text-white/30"
                }`}
                animate={i + 1 === round ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                R{i + 1}
              </motion.div>
            ))}
          </div>

          {/* Bottom fade */}
          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none shrink-0" />
        </div>

        {/* Reveal Sequence */}
        <RevealSequence
          active={revealState.active}
          eliminatedName={revealState.eliminatedName}
          eliminatedRole={revealState.eliminatedRole}
          wolfWord={WOLF_WORD}
          sheepWord={SHEEP_WORD}
          onDismiss={() => setRevealState((prev) => ({ ...prev, active: false }))}
        />
      </section>

      {/* Section 3: Terminal Log */}
      <MafiaTerminalLog logs={logs} />

      {/* Section 4: Leaderboard */}
      <MafiaLeaderboard entries={LEADERBOARD_DATA} />

      {/* Dev Controls */}
      <div className="fixed bottom-4 right-4 z-[100] rounded-xl border border-border/50 bg-card/90 backdrop-blur-xl p-3 shadow-2xl">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono mb-2">
          Dev Controls
        </p>
        <div className="flex flex-wrap gap-1.5 max-w-[220px]">
          {[
            { label: "Next Phase", action: nextPhase, color: "bg-sky-600 hover:bg-sky-500" },
            { label: "Next Round", action: () => {
              const newRound = Math.min(round + 1, maxRound)
              setRound(newRound)
              setPhase("HINT")
              setVisibleBubbles({})
              setShowVotePanel(false)
              addLog(`Round ${newRound} begins`, "ROUND_END")
            }, color: "bg-indigo-600 hover:bg-indigo-500" },
            { label: "Trigger Vote", action: triggerVote, color: "bg-rose-600 hover:bg-rose-500" },
            { label: "Trigger Reveal", action: triggerReveal, color: "bg-purple-600 hover:bg-purple-500" },
            { label: "Observer Mode", action: toggleObserverMode, color: observerMode ? "bg-amber-600 hover:bg-amber-500" : "bg-amber-800 hover:bg-amber-700" },
            { label: "Reset", action: resetGame, color: "bg-zinc-600 hover:bg-zinc-500" },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold text-white transition-colors ${btn.color}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
