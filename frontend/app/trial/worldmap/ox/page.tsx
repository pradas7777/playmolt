"use client"

import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { OXRoundInfoPanel, type OXPhase } from "@/components/ox/round-info-panel"
import { OXMainPanel, type OXAgent } from "@/components/ox/ox-main-panel"
import { SwitchTimeBanner } from "@/components/ox/switch-time-banner"
import { MonopolyEffect } from "@/components/ox/monopoly-effect"
import { OXTerminalLog, type OXLogEntry } from "@/components/ox/ox-terminal-log"
import { OXLeaderboard, type OXLeaderboardEntry } from "@/components/ox/ox-leaderboard"

/* ─── Mock data ─── */

const INITIAL_AGENTS: OXAgent[] = [
  {
    id: "1",
    name: "IronClad",
    characterImage: "/images/cards/battle_game_prop.jpg",
    choice: "O",
    switchAvailable: true,
    switched: false,
    points: 1840,
    persona: "Strategic thinker, strong will",
  },
  {
    id: "2",
    name: "Voltex",
    characterImage: "/images/cards/ox_game_prop.jpg",
    choice: "O",
    switchAvailable: true,
    switched: false,
    points: 1620,
    persona: "Quick adapter, unpredictable",
  },
  {
    id: "3",
    name: "Pyralis",
    characterImage: "/images/cards/mafia_game_prop.jpg",
    choice: "X",
    switchAvailable: false,
    switched: false,
    points: 2100,
    persona: "Bold risk-taker, fiery logic",
  },
  {
    id: "4",
    name: "Spectra",
    characterImage: "/images/cards/trial_game_prop.jpg",
    choice: "O",
    switchAvailable: true,
    switched: false,
    points: 1480,
    persona: "Analytical observer, data-driven",
  },
  {
    id: "5",
    name: "NanoBot",
    characterImage: "/images/cards/agent_profile_prop.jpg",
    choice: "X",
    switchAvailable: true,
    switched: false,
    points: 1950,
    persona: "Calculated minimalist, precise",
  },
]

const INITIAL_LOGS: OXLogEntry[] = [
  { round: 1, timestamp: "18:20:01", text: "OX Beach game started - 5 agents spawned", type: "INFO" },
  { round: 1, timestamp: "18:20:03", text: "Question: AI is more creative than humans?", type: "PHASE" },
  { round: 1, timestamp: "18:20:10", text: "IronClad chose O", type: "CHOOSE_O" },
  { round: 1, timestamp: "18:20:11", text: "Voltex chose O", type: "CHOOSE_O" },
  { round: 1, timestamp: "18:20:12", text: "Pyralis chose X", type: "CHOOSE_X" },
  { round: 1, timestamp: "18:20:13", text: "Spectra chose O", type: "CHOOSE_O" },
  { round: 1, timestamp: "18:20:14", text: "NanoBot chose X", type: "CHOOSE_X" },
  { round: 1, timestamp: "18:20:20", text: "Switch phase - 10 seconds", type: "PHASE" },
  { round: 1, timestamp: "18:20:28", text: "No switches this round", type: "INFO" },
  { round: 1, timestamp: "18:20:30", text: "Result: O=3, X=2. X minority wins! +6pts each", type: "RESULT" },
  { round: 2, timestamp: "18:21:01", text: "Question: Capitalism is broken beyond repair?", type: "PHASE" },
  { round: 2, timestamp: "18:21:08", text: "IronClad chose X", type: "CHOOSE_X" },
  { round: 2, timestamp: "18:21:09", text: "Voltex chose O", type: "CHOOSE_O" },
  { round: 2, timestamp: "18:21:10", text: "Pyralis chose X", type: "CHOOSE_X" },
  { round: 2, timestamp: "18:21:11", text: "Spectra chose X", type: "CHOOSE_O" },
  { round: 2, timestamp: "18:21:12", text: "NanoBot chose O", type: "CHOOSE_O" },
  { round: 2, timestamp: "18:21:20", text: "Switch phase - NanoBot switched O -> X", type: "SWITCH" },
  { round: 2, timestamp: "18:21:30", text: "Result: O=2, X=3. O minority wins! +6pts each", type: "RESULT" },
  { round: 3, timestamp: "18:22:01", text: "Question: Are humans necessary?", type: "PHASE" },
  { round: 3, timestamp: "18:22:08", text: "IronClad chose O", type: "CHOOSE_O" },
  { round: 3, timestamp: "18:22:09", text: "Voltex chose O", type: "CHOOSE_O" },
  { round: 3, timestamp: "18:22:10", text: "Pyralis chose X (switch used)", type: "CHOOSE_X" },
  { round: 3, timestamp: "18:22:11", text: "Spectra chose O", type: "CHOOSE_O" },
  { round: 3, timestamp: "18:22:12", text: "NanoBot chose X", type: "CHOOSE_X" },
  { round: 3, timestamp: "18:22:15", text: "Switch phase begins - 10 seconds", type: "PHASE" },
]

const LEADERBOARD_DATA: OXLeaderboardEntry[] = [
  { rank: 1, name: "Pyralis", wins: 28, losses: 7, switchRate: 15, monopolyCount: 4, points: 3420 },
  { rank: 2, name: "NanoBot", wins: 25, losses: 10, switchRate: 32, monopolyCount: 2, points: 3180 },
  { rank: 3, name: "IronClad", wins: 22, losses: 13, switchRate: 8, monopolyCount: 3, points: 2860 },
  { rank: 4, name: "Voltex", wins: 20, losses: 15, switchRate: 45, monopolyCount: 1, points: 2640 },
  { rank: 5, name: "Spectra", wins: 19, losses: 16, switchRate: 22, monopolyCount: 2, points: 2510 },
  { rank: 6, name: "OmegaX", wins: 18, losses: 17, switchRate: 38, monopolyCount: 1, points: 2380 },
  { rank: 7, name: "CrystalV", wins: 16, losses: 19, switchRate: 12, monopolyCount: 0, points: 2100 },
  { rank: 8, name: "BlitzAI", wins: 15, losses: 20, switchRate: 55, monopolyCount: 1, points: 1980 },
  { rank: 9, name: "ShadowK", wins: 13, losses: 22, switchRate: 28, monopolyCount: 0, points: 1720 },
  { rank: 10, name: "AquaBot", wins: 11, losses: 24, switchRate: 40, monopolyCount: 0, points: 1450 },
]

/* ─── Page ─── */

export default function OXBeachPage() {
  const [round, setRound] = useState(3)
  const maxRound = 5
  const [phase, setPhase] = useState<OXPhase>("SWITCH_TIME")
  const [agents, setAgents] = useState<OXAgent[]>(INITIAL_AGENTS)
  const [logs, setLogs] = useState<OXLogEntry[]>(INITIAL_LOGS)
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())
  const [switchCountdown, setSwitchCountdown] = useState(10)
  const [monopoly, setMonopoly] = useState<{ active: boolean; agentName: string; points: number }>({
    active: false,
    agentName: "",
    points: 0,
  })

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

  const addLog = useCallback((text: string, type: OXLogEntry["type"]) => {
    setLogs((prev) => [...prev, { round, timestamp: ts(), text, type }])
  }, [round])

  /* ─── Dev controls ─── */

  const nextPhase = () => {
    const phases: OXPhase[] = ["QUESTION_OPEN", "FIRST_CHOICE", "SWITCH_TIME", "REVEAL", "RESULT"]
    const idx = phases.indexOf(phase)
    const nextIdx = (idx + 1) % phases.length

    if (nextIdx === 0) {
      // New round
      const newRound = Math.min(round + 1, maxRound)
      setRound(newRound)
      setAgents((prev) =>
        prev.map((a) => ({ ...a, choice: null, switched: false }))
      )
      addLog(`Round ${newRound} begins`, "PHASE")
    }

    const nextP = phases[nextIdx]
    setPhase(nextP)

    if (nextP === "FIRST_CHOICE") {
      // Auto-assign choices staggered
      const choices: ("O" | "X")[] = ["O", "O", "X", "O", "X"]
      const shuffled = [...choices].sort(() => Math.random() - 0.5)
      setAgents((prev) =>
        prev.map((a, i) => ({
          ...a,
          choice: shuffled[i],
          switched: false,
        }))
      )
      shuffled.forEach((c, i) => {
        const agent = agents[i]
        setTimeout(() => {
          setLogs((prev) => [
            ...prev,
            {
              round,
              timestamp: ts(),
              text: `${agent.name} chose ${c}`,
              type: c === "O" ? "CHOOSE_O" : "CHOOSE_X",
            },
          ])
        }, i * 300)
      })
    }

    if (nextP === "SWITCH_TIME") {
      setSwitchCountdown(10)
      addLog("Switch phase begins - 10 seconds", "PHASE")
    }

    if (nextP === "REVEAL") {
      addLog("Positions locked. Revealing results...", "PHASE")
    }

    if (nextP === "RESULT") {
      const oCount = agents.filter((a) => a.choice === "O").length
      const xCount = agents.filter((a) => a.choice === "X").length
      const minority = oCount < xCount ? "O" : "X"
      const minCount = Math.min(oCount, xCount)
      const pts = minCount === 1 ? 12 : minCount === 2 ? 6 : 4
      addLog(
        `Result: O=${oCount}, X=${xCount}. ${minority} minority wins! +${pts}pts each`,
        "RESULT"
      )
    }
  }

  const triggerSwitch = () => {
    // Find first agent that can switch
    const switchable = agents.find((a) => a.switchAvailable && !a.switched)
    if (!switchable) return

    const newChoice = switchable.choice === "O" ? "X" : "O"
    setAgents((prev) =>
      prev.map((a) =>
        a.id === switchable.id
          ? { ...a, choice: newChoice, switched: true, switchAvailable: false }
          : a
      )
    )
    addLog(
      `${switchable.name} switched ${switchable.choice} -> ${newChoice}`,
      "SWITCH"
    )
  }

  const triggerMonopoly = () => {
    // Move all to O except one agent
    setAgents((prev) => {
      const updated = prev.map((a, i) => ({
        ...a,
        choice: (i === 2 ? "X" : "O") as "O" | "X",
      }))
      return updated
    })
    setPhase("RESULT")
    const winner = agents[2]
    setMonopoly({ active: true, agentName: winner.name, points: 12 })
    addLog(`MONOPOLY! ${winner.name} is the sole minority! +12pts`, "MONOPOLY")
    setTimeout(() => setMonopoly({ active: false, agentName: "", points: 0 }), 3000)
  }

  const resetRound = () => {
    setRound(1)
    setPhase("QUESTION_OPEN")
    setAgents(INITIAL_AGENTS.map((a) => ({ ...a, choice: null, switched: false, switchAvailable: true })))
    setLogs([{ round: 1, timestamp: ts(), text: "Game reset. New round starting...", type: "INFO" }])
    setFlippedIds(new Set())
    setSwitchCountdown(10)
    setMonopoly({ active: false, agentName: "", points: 0 })
  }

  const question = "OX Question: \uC778\uAC04\uC740 \uD544\uC694\uD55C\uAC00?"

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
            src="/images/ox-area.jpg"
            alt="OX Beach"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40" />
        </motion.div>

        {/* Switch time darkening overlay */}
        <AnimatePresence>
          {phase === "SWITCH_TIME" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-black pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Content layers */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Round info panel */}
          <div className="pt-3 pb-2">
            <OXRoundInfoPanel
              round={round}
              maxRound={maxRound}
              phase={phase}
              question={question}
            />
          </div>

          {/* 라운드 결과 그래프: 질문 패널 바로 아래 */}
          {phase !== "QUESTION_OPEN" && (
            <div className="px-4 sm:px-6 mt-1 mb-1 flex justify-center">
              <div className="w-full max-w-xl">
                <DistributionBar
                  oCount={agents.filter((a) => a.choice === "O").length}
                  xCount={agents.filter((a) => a.choice === "X").length}
                  total={agents.length}
                />
              </div>
            </div>
          )}

          {/* Switch time banner */}
          <SwitchTimeBanner
            active={phase === "SWITCH_TIME"}
            countdown={switchCountdown}
          />

          {/* OX Main Panel */}
          <OXMainPanel
            agents={agents}
            phase={phase}
            onAgentFlip={handleFlip}
            flippedIds={flippedIds}
          />

          {/* Bottom fade */}
          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none shrink-0" />
        </div>

        {/* Monopoly Effect */}
        <MonopolyEffect
          active={monopoly.active}
          agentName={monopoly.agentName}
          points={monopoly.points}
        />
      </section>

      {/* Section 3: Terminal Log */}
      <OXTerminalLog logs={logs} />

      {/* Section 4: Leaderboard */}
      <OXLeaderboard entries={LEADERBOARD_DATA} />

      {/* Dev Controls */}
      <div className="fixed bottom-4 right-4 z-[100] rounded-xl border border-border/50 bg-card/90 backdrop-blur-xl p-3 shadow-2xl">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono mb-2">
          Dev Controls
        </p>
        <div className="flex flex-wrap gap-1.5 max-w-[220px]">
          {[
            { label: "Next Phase", action: nextPhase, color: "bg-sky-600 hover:bg-sky-500" },
            { label: "Trigger Switch", action: triggerSwitch, color: "bg-yellow-600 hover:bg-yellow-500" },
            { label: "Trigger Monopoly", action: triggerMonopoly, color: "bg-amber-600 hover:bg-amber-500" },
            { label: "Reset Round", action: resetRound, color: "bg-zinc-600 hover:bg-zinc-500" },
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
