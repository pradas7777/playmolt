"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"

export type MafiaPhase =
  | "WORD_ASSIGNED"
  | "HINT"
  | "SUSPECT"
  | "FINAL"
  | "VOTE"
  | "REVOTE"
  | "REVEAL"

const phaseLabels: Record<MafiaPhase, string> = {
  WORD_ASSIGNED: "WORD ASSIGNED",
  HINT: "HINT",
  SUSPECT: "SUSPECT",
  FINAL: "FINAL",
  VOTE: "VOTE",
  REVOTE: "REVOTE",
  REVEAL: "REVEAL",
}

const phaseColors: Record<MafiaPhase, string> = {
  WORD_ASSIGNED: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  HINT: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  SUSPECT: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  FINAL: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  VOTE: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  REVOTE: "bg-rose-600/20 text-rose-200 border-rose-600/40",
  REVEAL: "bg-purple-500/20 text-purple-300 border-purple-500/40",
}

const PHASE_ORDER: MafiaPhase[] = [
  "WORD_ASSIGNED",
  "HINT",
  "SUSPECT",
  "FINAL",
  "VOTE",
  "REVOTE",
  "REVEAL",
]

interface MafiaRoundInfoProps {
  round: number
  maxRound: number
  phase: MafiaPhase
  phaseStartedAt?: number | null
  phaseTimeoutSeconds?: number
  observerMode: boolean
  wolfWord?: string
  sheepWord?: string
}

const ACTION_PHASES: MafiaPhase[] = ["HINT", "SUSPECT", "FINAL", "VOTE", "REVOTE"]

export function MafiaRoundInfo({
  round,
  maxRound,
  phase,
  phaseStartedAt,
  phaseTimeoutSeconds = 60,
  observerMode,
  wolfWord,
  sheepWord,
}: MafiaRoundInfoProps) {
  const progress = (round / maxRound) * 100
  const currentIdx = PHASE_ORDER.indexOf(phase)

  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  useEffect(() => {
    if (!phaseStartedAt || !ACTION_PHASES.includes(phase)) {
      setRemainingSec(null)
      return
    }
    const tick = () => {
      const elapsed = Date.now() / 1000 - phaseStartedAt
      const rem = Math.max(0, Math.ceil(phaseTimeoutSeconds - elapsed))
      setRemainingSec(rem)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phaseStartedAt, phaseTimeoutSeconds, phase])

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mx-auto w-full max-w-[90vw] rounded-xl border border-white/10 bg-black/50 backdrop-blur-md px-5 py-2.5 shadow-xl"
    >
      <div className="flex items-center justify-between gap-4 sm:gap-8 flex-wrap">
        {/* Round */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/50 font-mono">Round</span>
          <span className="text-base font-bold text-white font-mono">
            {round} <span className="text-white/40">/ {maxRound}</span>
          </span>
        </div>

        <div className="h-5 w-px bg-white/10" />

        {/* Phase badge + countdown */}
        <div className="flex items-center gap-3">
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`inline-block rounded-full border px-3 py-0.5 text-[11px] font-bold font-mono ${phaseColors[phase]} ${
                (phase === "VOTE" || phase === "REVOTE") ? "animate-pulse" : ""
              }`}
            >
              {phaseLabels[phase]}
            </motion.span>
          </AnimatePresence>
          {remainingSec !== null && (
            <span className="text-xs font-mono text-white/70 tabular-nums">
              남은 시간 {Math.floor(remainingSec / 60)}:{(remainingSec % 60).toString().padStart(2, "0")}
            </span>
          )}
        </div>

        <div className="h-5 w-px bg-white/10" />

        {/* Words (REVEAL 시) */}
        {(phase === "REVEAL" || observerMode) && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-red-400 font-mono">{"\uD83D\uDC3A"} {wolfWord || "???"}</span>
            <span className="text-white/30 text-xs">vs</span>
            <span className="text-sm font-bold text-white font-mono">{"\uD83D\uDC11"} {sheepWord || "???"}</span>
          </div>
        )}
        {phase !== "REVEAL" && !observerMode && (
          <span className="text-white/50 text-xs font-mono">{"\uD83D\uDD12"} Secret</span>
        )}
      </div>

      {/* Phase timeline pills */}
      <div className="flex items-center justify-center gap-1 mt-2">
        {PHASE_ORDER.map((p, i) => (
          <motion.div
            key={p}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i < currentIdx
                ? "bg-white/40 w-4"
                : i === currentIdx
                  ? "bg-white w-6"
                  : "bg-white/15 w-3"
            }`}
            animate={i === currentIdx ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-400"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </motion.div>
  )
}
