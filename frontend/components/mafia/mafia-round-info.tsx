"use client"

import { motion, AnimatePresence } from "motion/react"

export type MafiaPhase =
  | "WORD_ASSIGNED"
  | "HINT_ROUND_1"
  | "HINT_ROUND_2"
  | "HINT_ROUND_3"
  | "VOTE"
  | "REVEAL"

const phaseLabels: Record<MafiaPhase, string> = {
  WORD_ASSIGNED: "WORD ASSIGNED",
  HINT_ROUND_1: "HINT ROUND 1",
  HINT_ROUND_2: "HINT ROUND 2",
  HINT_ROUND_3: "HINT ROUND 3",
  VOTE: "VOTE",
  REVEAL: "REVEAL",
}

const phaseColors: Record<MafiaPhase, string> = {
  WORD_ASSIGNED: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  HINT_ROUND_1: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  HINT_ROUND_2: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  HINT_ROUND_3: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  VOTE: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  REVEAL: "bg-purple-500/20 text-purple-300 border-purple-500/40",
}

const PHASE_ORDER: MafiaPhase[] = [
  "WORD_ASSIGNED",
  "HINT_ROUND_1",
  "HINT_ROUND_2",
  "HINT_ROUND_3",
  "VOTE",
  "REVEAL",
]

interface MafiaRoundInfoProps {
  round: number
  maxRound: number
  phase: MafiaPhase
  observerMode: boolean
  wolfWord?: string
  sheepWord?: string
}

export function MafiaRoundInfo({
  round,
  maxRound,
  phase,
  observerMode,
  wolfWord,
  sheepWord,
}: MafiaRoundInfoProps) {
  const progress = (round / maxRound) * 100
  const currentIdx = PHASE_ORDER.indexOf(phase)

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mx-auto w-fit max-w-[90vw] rounded-xl border border-white/10 bg-black/50 backdrop-blur-md px-5 py-3 shadow-xl"
    >
      <div className="flex items-center justify-center gap-4 sm:gap-6">
        {/* Round */}
        <div className="text-center">
          <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono">Round</span>
          <span className="block text-lg font-bold text-white font-mono">
            {round} <span className="text-white/40">/ {maxRound}</span>
          </span>
        </div>

        <div className="h-8 w-px bg-white/10" />

        {/* Phase badge */}
        <div className="text-center">
          <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono mb-1">Phase</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`inline-block rounded-full border px-3 py-0.5 text-[11px] font-bold font-mono ${phaseColors[phase]} ${
                phase === "VOTE" ? "animate-pulse" : ""
              }`}
            >
              {phaseLabels[phase]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      {/* Phase timeline pills */}
      <div className="flex items-center justify-center gap-1 mt-3">
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

      {/* Word display */}
      <div className="mt-3 text-center">
        {phase === "REVEAL" || observerMode ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-1"
          >
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold text-red-400 font-mono">
                {"\uD83D\uDC3A"} {wolfWord || "???"}
              </span>
              <span className="text-white/30 text-sm">vs</span>
              <span className="text-lg font-bold text-white font-mono">
                {"\uD83D\uDC11"} {sheepWord || "???"}
              </span>
            </div>
            <span className="text-[9px] text-white/40 font-mono uppercase tracking-wider">
              {observerMode && phase !== "REVEAL"
                ? "Observer Mode - Words visible"
                : "Words revealed to observers"}
            </span>
            {observerMode && (
              <span className="mt-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-[9px] font-bold font-mono text-amber-300">
                OBSERVER MODE
              </span>
            )}
          </motion.div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <span className="text-white/60 text-sm font-mono">
              {"\uD83D\uDD12"} Secret Word Hidden
            </span>
          </div>
        )}
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
