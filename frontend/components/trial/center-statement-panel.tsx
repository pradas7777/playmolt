"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"

export type SpeakerRole = "PROSECUTOR" | "DEFENSE" | "JUROR_1" | "JUROR_2" | "JUROR_3"

const SPEAKER_ORDER: SpeakerRole[] = ["PROSECUTOR", "DEFENSE", "JUROR_1", "JUROR_2", "JUROR_3"]

const speakerLabels: Record<SpeakerRole, string> = {
  PROSECUTOR: "\uAC80\uC0AC",
  DEFENSE: "\uBCC0\uD638\uC0AC",
  JUROR_1: "\uBC30\uC2EC\uC6D01",
  JUROR_2: "\uBC30\uC2EC\uC6D02",
  JUROR_3: "\uBC30\uC2EC\uC6D03",
}

const speakerColors: Record<string, string> = {
  PROSECUTOR: "border-l-rose-500 shadow-rose-500/10",
  DEFENSE: "border-l-sky-500 shadow-sky-500/10",
  JUROR_1: "border-l-amber-500 shadow-amber-500/10",
  JUROR_2: "border-l-amber-500 shadow-amber-500/10",
  JUROR_3: "border-l-amber-500 shadow-amber-500/10",
}

const speakerBadge: Record<string, string> = {
  PROSECUTOR: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  DEFENSE: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  JUROR_1: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  JUROR_2: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  JUROR_3: "bg-amber-500/20 text-amber-300 border-amber-500/30",
}

function StatementTypewriter({ text, speed = 25 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    setDisplayed("")
    let idx = 0
    const interval = setInterval(() => {
      idx++
      setDisplayed(text.slice(0, idx))
      if (idx >= text.length) clearInterval(interval)
    }, speed)
    return () => clearInterval(interval)
  }, [text, speed])

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span className="animate-pulse text-white/30">|</span>
      )}
    </span>
  )
}

interface CenterStatementPanelProps {
  currentSpeaker: SpeakerRole
  speakerName: string
  statement: string
  argumentRound: number
  totalRounds: number
  phaseLabel: string
  visible: boolean
}

export function CenterStatementPanel({
  currentSpeaker,
  speakerName,
  statement,
  argumentRound,
  totalRounds,
  phaseLabel,
  visible,
}: CenterStatementPanelProps) {
  const currentIdx = SPEAKER_ORDER.indexOf(currentSpeaker)

  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, type: "spring", stiffness: 200 }}
      className={`w-[320px] sm:w-[380px] rounded-xl border border-white/10 border-l-4 ${speakerColors[currentSpeaker]} bg-black/60 backdrop-blur-xl px-5 py-4 shadow-2xl`}
    >
      {/* Speaker badge */}
      <div className="flex items-center gap-2 mb-3">
        <AnimatePresence mode="wait">
          <motion.span
            key={currentSpeaker}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold font-mono ${speakerBadge[currentSpeaker]}`}
          >
            {speakerLabels[currentSpeaker]}
          </motion.span>
        </AnimatePresence>
        <span className="text-xs font-medium text-white/70">{speakerName}</span>
      </div>

      {/* Statement text */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${currentSpeaker}-${statement}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
        >
          <p className="text-sm sm:text-base font-medium text-white leading-relaxed min-h-[40px]">
            <StatementTypewriter text={statement} />
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Round info */}
      <div className="mt-3 pt-2 border-t border-white/10">
        <p className="text-[10px] font-mono text-white/40">
          Round {argumentRound} of {totalRounds} &middot; {phaseLabel}
        </p>

        {/* Speaking order indicator */}
        <div className="flex items-center gap-1.5 mt-2">
          {SPEAKER_ORDER.map((s, i) => {
            const isActive = i === currentIdx
            const isDone = i < currentIdx
            return (
              <div key={s} className="flex items-center gap-1">
                {i > 0 && (
                  <span className={`text-[8px] ${isDone || isActive ? "text-white/40" : "text-white/15"}`}>
                    {"\u2192"}
                  </span>
                )}
                <motion.span
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded transition-all ${
                    isActive
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "text-white/40"
                        : "text-white/20"
                  }`}
                  animate={isActive ? { scale: [1, 1.05, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  {speakerLabels[s]}
                </motion.span>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
