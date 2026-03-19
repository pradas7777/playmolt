"use client"

import { motion, AnimatePresence } from "motion/react"

/** 새 플로우: opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict */
export type TrialPhase =
  | "OPENING"
  | "ARGUMENT_1"
  | "JURY_INTERIM"
  | "JUDGE_EXPAND"
  | "ARGUMENT_2"
  | "JURY_FINAL"
  | "VERDICT"
  | "ARGUMENT_3"
  | "REBUTTAL"
  | "JURY_VOTE"

const phaseLabels: Record<TrialPhase, string> = {
  OPENING: "OPENING",
  ARGUMENT_1: "ARGUMENT 1",
  JURY_INTERIM: "JURY INTERIM",
  JUDGE_EXPAND: "JUDGE EXPAND",
  ARGUMENT_2: "ARGUMENT 2",
  JURY_FINAL: "JURY FINAL",
  VERDICT: "VERDICT",
  ARGUMENT_3: "ARGUMENT 3",
  REBUTTAL: "REBUTTAL",
  JURY_VOTE: "JURY VOTE",
}

const phaseColors: Record<TrialPhase, string> = {
  OPENING: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  ARGUMENT_1: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  JURY_INTERIM: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  JUDGE_EXPAND: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  ARGUMENT_2: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  JURY_FINAL: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  VERDICT: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  ARGUMENT_3: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  REBUTTAL: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  JURY_VOTE: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
}

const PHASE_ORDER: TrialPhase[] = [
  "OPENING",
  "ARGUMENT_1",
  "JURY_INTERIM",
  "JUDGE_EXPAND",
  "ARGUMENT_2",
  "JURY_FINAL",
  "VERDICT",
]

interface CaseInfoPanelProps {
  caseTitle: string
  caseDescription: string
  phase: TrialPhase
  round: number
  maxRound: number
}

export function CaseInfoPanel({
  caseTitle,
  caseDescription,
  phase,
  round,
  maxRound,
}: CaseInfoPanelProps) {
  const currentIdx = PHASE_ORDER.indexOf(phase)
  const progress = currentIdx >= 0 ? ((currentIdx + 1) / PHASE_ORDER.length) * 100 : 50
  const phaseLabel = phaseLabels[phase] ?? String(phase)
  const phaseColor = phaseColors[phase] ?? "bg-white/20 text-white border-white/30"

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mx-auto w-full max-w-[700px] rounded-lg sm:rounded-xl border border-white/10 bg-black/50 backdrop-blur-md px-3 py-2 sm:px-5 sm:py-3 shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-lg font-bold text-white truncate text-balance">
            {caseTitle}
          </h2>
          <p className="text-[10px] sm:text-xs text-white/50 mt-0.5 line-clamp-1 sm:line-clamp-2 leading-relaxed">
            {caseDescription}
          </p>
        </div>

        <div className="shrink-0 text-center">
          <span className="block text-[8px] sm:text-[9px] uppercase tracking-wider text-white/40 font-mono mb-0.5 sm:mb-1">Phase</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`inline-block rounded-full border px-2 py-0.5 sm:px-3 text-[9px] sm:text-[10px] font-bold font-mono ${phaseColor} ${
                phase === "VERDICT" || phase === "JURY_FINAL" ? "animate-pulse" : ""
              }`}
            >
              {phaseLabel}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center justify-center gap-0.5 mt-2 sm:mt-3 flex-wrap">
        {PHASE_ORDER.map((p, i) => (
          <motion.div
            key={p}
            className={`h-1 sm:h-1.5 rounded-full transition-all duration-300 shrink-0 ${
              i < currentIdx
                ? "bg-white/40 w-1.5 sm:w-2"
                : i === currentIdx
                  ? "bg-white w-2 sm:w-3"
                  : "bg-white/15 w-1 sm:w-1.5"
            }`}
            animate={i === currentIdx ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        ))}
      </div>

      <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-400"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </motion.div>
  )
}
