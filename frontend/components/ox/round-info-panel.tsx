"use client"

import { motion, AnimatePresence } from "motion/react"

export type OXPhase = "QUESTION_OPEN" | "FIRST_CHOICE" | "SWITCH_TIME" | "REVEAL" | "RESULT"

const phaseLabels: Record<OXPhase, string> = {
  QUESTION_OPEN: "QUESTION OPEN",
  FIRST_CHOICE: "CHOICE PHASE",
  SWITCH_TIME: "SWITCH TIME",
  REVEAL: "REVEAL",
  RESULT: "RESULT",
}

const phaseColors: Record<OXPhase, string> = {
  QUESTION_OPEN: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  FIRST_CHOICE: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  SWITCH_TIME: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  REVEAL: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  RESULT: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
}

interface RoundInfoPanelProps {
  round: number
  maxRound: number
  phase: OXPhase
  question: string
}

export function OXRoundInfoPanel({ round, maxRound, phase, question }: RoundInfoPanelProps) {
  const progress = (round / maxRound) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mx-auto w-fit max-w-[90vw] rounded-lg sm:rounded-xl border border-white/10 bg-black/50 backdrop-blur-md px-3 py-2 sm:px-5 sm:py-3 shadow-xl"
    >
      <div className="flex items-center justify-center gap-2 sm:gap-6">
        {/* Round */}
        <div className="text-center">
          <span className="block text-[9px] sm:text-[10px] uppercase tracking-wider text-white/50 font-mono">Round</span>
          <span className="block text-base sm:text-lg font-bold text-white font-mono">
            {round} <span className="text-white/40">/ {maxRound}</span>
          </span>
        </div>

        <div className="h-6 sm:h-8 w-px bg-white/10" />

        {/* Phase badge */}
        <div className="text-center">
          <span className="block text-[9px] sm:text-[10px] uppercase tracking-wider text-white/50 font-mono mb-0.5 sm:mb-1">Phase</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`inline-block rounded-full border px-2 py-0.5 sm:px-3 text-[10px] sm:text-[11px] font-bold font-mono ${phaseColors[phase]} ${
                phase === "SWITCH_TIME" ? "animate-pulse" : ""
              }`}
            >
              {phaseLabels[phase]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      {/* Question */}
      <motion.p
        key={question}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 sm:mt-3 text-center text-xs sm:text-base font-bold text-white max-w-lg line-clamp-2 sm:line-clamp-none"
      >
        {question}
      </motion.p>

      {/* Progress bar */}
      <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-teal-500 to-rose-400"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </motion.div>
  )
}
