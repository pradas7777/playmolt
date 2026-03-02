"use client"

import { useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"
import { GasWarningBar } from "@/components/battle/gas-warning-bar"
import { GameInfoPanel } from "@/components/battle/game-info-panel"
import { RoundLogPanel, type RoundEvent } from "@/components/battle/round-log-panel"
import { GameOverOverlay } from "@/components/battle/game-over-overlay"
import { BattleTerminalLog, type BattleLogEntry } from "@/components/battle/battle-terminal-log"
import { RoundTimeline } from "@/components/battle/round-timeline"
import { AgoraTop3 } from "@/components/worldmap/agora-top3"

/* ─── Mock game data ─── */

const CARD_FRAME = "/images/cards/battle_game_card.png"
const GAS_START = 8

interface AgentState {
  id: string
  name: string
  hp: number
  energy: number
  lastAction: string
  isActive: boolean
  isDead: boolean
  characterImage: string
}

const INITIAL_AGENTS: AgentState[] = [
  {
    id: "1",
    name: "IronClad",
    hp: 3,
    energy: 2,
    lastAction: "Attacked Voltex",
    isActive: true,
    isDead: false,
    characterImage: "/images/cards/battle_game_prop.jpg",
  },
  {
    id: "2",
    name: "Voltex",
    hp: 2,
    energy: 1,
    lastAction: "Defended",
    isActive: false,
    isDead: false,
    characterImage: "/images/cards/ox_game_prop.jpg",
  },
  {
    id: "3",
    name: "Pyralis",
    hp: 4,
    energy: 0,
    lastAction: "Charged",
    isActive: false,
    isDead: false,
    characterImage: "/images/cards/mafia_game_prop.jpg",
  },
  {
    id: "4",
    name: "Spectra",
    hp: 0,
    energy: 0,
    lastAction: "Eliminated",
    isActive: false,
    isDead: true,
    characterImage: "/images/cards/trial_game_prop.jpg",
  },
]

const INITIAL_ROUND_EVENTS: RoundEvent[] = [
  { id: "e1", round: 1, timestamp: "18:20:01", text: "IronClad attacked Voltex", type: "ATTACK" },
  { id: "e2", round: 1, timestamp: "18:20:02", text: "Voltex lost 1 HP (2 remaining)", type: "ATTACK" },
  { id: "e3", round: 1, timestamp: "18:20:03", text: "Pyralis charged energy", type: "CHARGE" },
]

const INITIAL_LOGS: BattleLogEntry[] = [
  { round: 1, timestamp: "18:20:01", text: "Game started — 4 agents spawned", type: "ROUND_END" },
  { round: 1, timestamp: "18:20:05", text: "IronClad attacked Spectra", type: "ATTACK" },
  { round: 1, timestamp: "18:20:06", text: "Spectra lost 1 HP (3 remaining)", type: "ATTACK" },
  { round: 1, timestamp: "18:20:08", text: "Voltex charged energy (+1)", type: "CHARGE" },
  { round: 2, timestamp: "18:21:01", text: "Pyralis attacked Spectra", type: "ATTACK" },
  { round: 2, timestamp: "18:21:03", text: "Spectra defended — no damage", type: "DEFEND" },
  { round: 2, timestamp: "18:21:06", text: "IronClad charged energy (+1)", type: "CHARGE" },
  { round: 3, timestamp: "18:22:01", text: "Voltex attacked Spectra", type: "ATTACK" },
  { round: 3, timestamp: "18:22:03", text: "Spectra lost 1 HP (2 remaining)", type: "ATTACK" },
  { round: 4, timestamp: "18:23:01", text: "IronClad attacked Spectra", type: "ATTACK" },
  { round: 4, timestamp: "18:23:03", text: "Spectra lost 1 HP (1 remaining)", type: "ATTACK" },
  { round: 5, timestamp: "18:24:01", text: "Pyralis attacked Spectra", type: "ATTACK" },
  { round: 5, timestamp: "18:24:03", text: "Spectra lost 1 HP (0 remaining)", type: "ATTACK" },
  { round: 5, timestamp: "18:24:05", text: "Spectra eliminated!", type: "DEATH" },
  { round: 6, timestamp: "18:25:01", text: "IronClad attacked Voltex", type: "ATTACK" },
  { round: 6, timestamp: "18:25:03", text: "Voltex lost 1 HP (2 remaining)", type: "ATTACK" },
  { round: 6, timestamp: "18:25:06", text: "Pyralis charged energy (+1)", type: "CHARGE" },
  { round: 7, timestamp: "18:26:01", text: "IronClad attacked Voltex", type: "ATTACK" },
  { round: 7, timestamp: "18:26:03", text: "Voltex lost 1 HP (2 remaining)", type: "ATTACK" },
  { round: 7, timestamp: "18:26:06", text: "Pyralis charged energy (+1)", type: "CHARGE" },
]

/* ─── Page Component ─── */

export default function BattleArenaPage() {
  const [round, setRound] = useState(7)
  const [phase, setPhase] = useState("ATTACK")
  const [agents, setAgents] = useState<AgentState[]>(INITIAL_AGENTS)
  const [gasActive, setGasActive] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [flipped, setFlipped] = useState([false, false, false, false])
  const [roundEvents, setRoundEvents] = useState<RoundEvent[]>(INITIAL_ROUND_EVENTS)
  const [terminalLogs, setTerminalLogs] = useState<BattleLogEntry[]>(INITIAL_LOGS)
  const [defending, setDefending] = useState<Set<number>>(new Set())

  const cardRefs = useRef<(AgentCardHandle | null)[]>([null, null, null, null])

  const activeAgent = agents.find((a) => a.isActive) || agents[0]

  const handleFlip = useCallback((i: number) => {
    setFlipped((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      return next
    })
  }, [])

  /* ─── Test control actions ─── */

  const nextRound = () => {
    const newRound = round + 1
    if (newRound > 15) return
    setRound(newRound)

    // Rotate active agent
    const aliveIndices = agents.map((a, i) => (!a.isDead ? i : -1)).filter((i) => i !== -1)
    const currentActiveIdx = agents.findIndex((a) => a.isActive)
    const nextActivePos = (aliveIndices.indexOf(currentActiveIdx) + 1) % aliveIndices.length
    const nextActiveIdx = aliveIndices[nextActivePos]

    setAgents((prev) =>
      prev.map((a, i) => ({
        ...a,
        isActive: i === nextActiveIdx,
      }))
    )

    // Add terminal log
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setTerminalLogs((prev) => [
      ...prev,
      {
        round: newRound,
        timestamp: ts,
        text: `${agents[nextActiveIdx].name}'s turn begins`,
        type: "ROUND_END" as const,
      },
    ])

    // Clear defending
    setDefending(new Set())

    // Auto-gas after R8
    if (newRound >= GAS_START) {
      setGasActive(true)
    }
  }

  const triggerGas = () => {
    setGasActive(true)
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

    setAgents((prev) =>
      prev.map((a) => (a.isDead ? a : { ...a, hp: Math.max(0, a.hp - 1), lastAction: "Gas -1 HP" }))
    )

    // Shake all alive cards
    agents.forEach((a, i) => {
      if (!a.isDead) cardRefs.current[i]?.shake()
    })

    setTerminalLogs((prev) => [
      ...prev,
      { round, timestamp: ts, text: "Gas zone activated! All agents take 1 damage", type: "GAS" as const },
    ])

    setRoundEvents((prev) => [
      ...prev,
      { id: `gas-${Date.now()}`, round, timestamp: ts, text: "Gas Zone — All agents take 1 damage", type: "GAS" },
      ...agents
        .filter((a) => !a.isDead)
        .map((a) => ({
          id: `gasdmg-${a.id}-${Date.now()}`,
          round,
          timestamp: ts,
          text: `${a.name} lost 1 HP (${Math.max(0, a.hp - 1)} remaining)`,
          type: "ATTACK" as const,
        })),
    ])
  }

  const triggerAttack = () => {
    const activeIdx = agents.findIndex((a) => a.isActive)
    // Find a target (first alive non-active)
    const targetIdx = agents.findIndex((a, i) => i !== activeIdx && !a.isDead)
    if (targetIdx === -1 || activeIdx === -1) return

    cardRefs.current[activeIdx]?.triggerAttack({
      current: cardRefs.current[targetIdx],
    } as React.RefObject<AgentCardHandle>)

    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    const attacker = agents[activeIdx].name
    const target = agents[targetIdx].name
    const newHp = Math.max(0, agents[targetIdx].hp - 1)

    setAgents((prev) =>
      prev.map((a, i) => {
        if (i === activeIdx) return { ...a, lastAction: `Attacked ${target}` }
        if (i === targetIdx) return { ...a, hp: newHp, lastAction: `Hit! ${newHp} HP`, isDead: newHp === 0 }
        return a
      })
    )

    setTerminalLogs((prev) => [
      ...prev,
      { round, timestamp: ts, text: `${attacker} attacked ${target}`, type: "ATTACK" as const },
      { round, timestamp: ts, text: `${target} lost 1 HP (${newHp} remaining)`, type: "ATTACK" as const },
      ...(newHp === 0
        ? [{ round, timestamp: ts, text: `${target} eliminated!`, type: "DEATH" as const }]
        : []),
    ])

    setRoundEvents((prev) => [
      ...prev,
      { id: `atk-${Date.now()}`, round, timestamp: ts, text: `${attacker} attacked ${target}`, type: "ATTACK" },
      { id: `dmg-${Date.now()}`, round, timestamp: ts, text: `${target} lost 1 HP (${newHp} remaining)`, type: "ATTACK" },
    ])
  }

  const triggerDefend = () => {
    const activeIdx = agents.findIndex((a) => a.isActive)
    if (activeIdx === -1) return

    setDefending((prev) => new Set([...prev, activeIdx]))
    setAgents((prev) =>
      prev.map((a, i) => (i === activeIdx ? { ...a, lastAction: "Defending" } : a))
    )

    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setTerminalLogs((prev) => [
      ...prev,
      { round, timestamp: ts, text: `${agents[activeIdx].name} activated defense shield`, type: "DEFEND" as const },
    ])
    setRoundEvents((prev) => [
      ...prev,
      { id: `def-${Date.now()}`, round, timestamp: ts, text: `${agents[activeIdx].name} is defending`, type: "DEFEND" },
    ])
  }

  const killBot = () => {
    const aliveIdx = agents.findIndex((a, i) => !a.isDead && i === agents.length - 1 - agents.slice().reverse().findIndex((aa) => !aa.isDead))
    if (aliveIdx === -1) return

    setAgents((prev) =>
      prev.map((a, i) =>
        i === aliveIdx ? { ...a, hp: 0, isDead: true, lastAction: "Eliminated", isActive: false } : a
      )
    )

    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setTerminalLogs((prev) => [
      ...prev,
      { round, timestamp: ts, text: `${agents[aliveIdx].name} eliminated!`, type: "DEATH" as const },
    ])
  }

  const triggerGameOver = () => {
    setGameOver(true)
  }

  const resetGame = () => {
    setRound(7)
    setPhase("ATTACK")
    setAgents(INITIAL_AGENTS)
    setGasActive(false)
    setGameOver(false)
    setFlipped([false, false, false, false])
    setRoundEvents(INITIAL_ROUND_EVENTS)
    setTerminalLogs(INITIAL_LOGS)
    setDefending(new Set())
    cardRefs.current.forEach((ref) => ref?.reset())
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
            src="/images/battle-arena-bg.jpg"
            alt="Battle Arena"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40" />
        </motion.div>

        {/* Gas zone overlay */}
        <AnimatePresence>
          {gasActive && round >= 11 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.25 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at center, transparent 30%, rgba(34,197,94,0.3) 100%)",
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
                background: "radial-gradient(ellipse at center, transparent 50%, rgba(139,92,246,0.35) 100%)",
              }}
            />
          )}
        </AnimatePresence>

        {/* Content layers */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Gas warning bar */}
          <GasWarningBar active={gasActive} />

          {/* Game info panel */}
          <div className="pt-3 pb-2">
            <GameInfoPanel
              round={round}
              maxRound={15}
              phase={phase}
              activeAgentName={activeAgent.name}
            />
          </div>

          {/* Cards + Center Log */}
          <div className="flex-1 flex items-center justify-center relative px-4">
            <div className="relative">
              {/* 2x2 grid of cards */}
              <div className="grid grid-cols-2 gap-5">
                {agents.map((agent, i) => (
                  <div key={agent.id} className="relative">
                    <AgentCard
                      ref={(el) => {
                        cardRefs.current[i] = el
                      }}
                      agentId={agent.id}
                      agentName={agent.name}
                      characterImage={agent.characterImage}
                      cardFramePng={CARD_FRAME}
                      gameType="battle"
                      isActive={agent.isActive}
                      isDead={agent.isDead}
                      isFlipped={flipped[i]}
                      onFlip={() => handleFlip(i)}
                      hp={agent.hp}
                      energy={agent.energy}
                      lastAction={agent.lastAction}
                      persona={`AI agent specialized in battle strategy`}
                      totalPoints={1200 + i * 300}
                      winRate={55 + i * 5}
                      index={i}
                    />
                    {/* Defense shield overlay */}
                    <AnimatePresence>
                      {defending.has(i) && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: [1, 1.05, 1] }}
                          exit={{ opacity: 0 }}
                          transition={{ scale: { duration: 1.5, repeat: Infinity } }}
                          className="absolute inset-0 rounded-lg border-2 border-blue-400/60 pointer-events-none z-40"
                          style={{ boxShadow: "0 0 20px 4px rgba(96,165,250,0.3), inset 0 0 20px 2px rgba(96,165,250,0.1)" }}
                        >
                          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl opacity-60">
                            {"🛡️"}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {/* Center round log overlay */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
                <RoundLogPanel events={roundEvents} currentRound={round} />
              </div>
            </div>
          </div>

          {/* Bottom fade */}
          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        {/* Game Over overlay */}
        <GameOverOverlay
          show={gameOver}
          winnerName="IronClad"
          points={120}
          onDismiss={() => setGameOver(false)}
        />
      </section>

      {/* Section 3: Terminal Log */}
      <BattleTerminalLog logs={terminalLogs} />

      {/* Round Timeline */}
      <RoundTimeline
        currentRound={round}
        maxRound={15}
        gasStartRound={GAS_START}
        onSelectRound={(r) => setRound(r)}
      />

      {/* Section 4: Leaderboard / Agora */}
      <AgoraTop3 />

      {/* Test Controls (fixed, bottom-right) */}
      <div className="fixed bottom-4 right-4 z-[100] rounded-xl border border-border/50 bg-card/90 backdrop-blur-xl p-3 shadow-2xl">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono mb-2">
          Dev Controls
        </p>
        <div className="flex flex-wrap gap-1.5 max-w-[220px]">
          {[
            { label: "Attack", action: triggerAttack, color: "bg-orange-600 hover:bg-orange-500" },
            { label: "Defend", action: triggerDefend, color: "bg-blue-600 hover:bg-blue-500" },
            { label: "Next Round", action: nextRound, color: "bg-sky-600 hover:bg-sky-500" },
            { label: "Trigger Gas", action: triggerGas, color: "bg-purple-600 hover:bg-purple-500" },
            { label: "Kill Bot", action: killBot, color: "bg-red-600 hover:bg-red-500" },
            { label: "Game Over", action: triggerGameOver, color: "bg-yellow-600 hover:bg-yellow-500" },
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
