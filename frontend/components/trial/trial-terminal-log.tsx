"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "motion/react"

export interface TrialLogEntry {
  round: number
  timestamp: string
  text: string
  type:
    | "PROSECUTOR"
    | "DEFENSE"
    | "JUROR"
    | "EVIDENCE"
    | "VERDICT_GUILTY"
    | "VERDICT_NOT_GUILTY"
    | "PHASE_CHANGE"
    | "INFO"
}

const typeColors: Record<string, string> = {
  PROSECUTOR: "text-rose-400",
  DEFENSE: "text-sky-400",
  JUROR: "text-amber-400",
  EVIDENCE: "text-teal-400 italic",
  VERDICT_GUILTY: "text-red-400 font-bold",
  VERDICT_NOT_GUILTY: "text-sky-400 font-bold",
  PHASE_CHANGE: "text-white/30",
  INFO: "text-white/50",
}

const typeBadgeColors: Record<string, string> = {
  PROSECUTOR: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  DEFENSE: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  JUROR: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  EVIDENCE: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  VERDICT_GUILTY: "bg-red-500/20 text-red-400 border-red-500/30",
  VERDICT_NOT_GUILTY: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  PHASE_CHANGE: "bg-white/5 text-white/30 border-white/10",
  INFO: "bg-white/5 text-white/40 border-white/10",
}

const typePrefix: Record<string, string> = {
  PROSECUTOR: "PROS",
  DEFENSE: "DEF",
  JUROR: "JURY",
  EVIDENCE: "EVID",
  VERDICT_GUILTY: "VERD",
  VERDICT_NOT_GUILTY: "VERD",
  PHASE_CHANGE: "---",
  INFO: "i",
}

export function TrialTerminalLog({ logs }: { logs: TrialLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, paused])

  let lastRound = -1

  return (
    <section className="px-4 sm:px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
        >
          {/* macOS terminal frame */}
          <div className="rounded-2xl border border-border/50 bg-[#0a0a0a] shadow-2xl overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] border-b border-white/5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 font-mono text-[11px] text-white/40">
                {"MOLT TRIAL LOG"}
              </span>
            </div>

            {/* Scanline overlay */}
            <div className="relative">
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(100,100,255,0.01) 2px, rgba(100,100,255,0.01) 4px)",
                }}
              />

              {/* Log content */}
              <div
                ref={scrollRef}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                className="h-[360px] sm:h-[420px] overflow-y-auto p-4 sm:p-6 font-mono text-xs sm:text-sm scrollbar-hide"
              >
                <div className="flex flex-col gap-1">
                  {logs.map((entry, i) => {
                    const showDivider = entry.round !== lastRound
                    lastRound = entry.round
                    return (
                      <div key={i}>
                        {showDivider && (
                          <div className="flex items-center gap-2 my-2">
                            <span className="flex-1 border-t border-white/10" />
                            <span className="text-[10px] uppercase tracking-widest text-white/25 font-bold">
                              Round {entry.round}
                            </span>
                            <span className="flex-1 border-t border-white/10" />
                          </div>
                        )}
                        <motion.div
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: i * 0.01 }}
                          className="flex items-start gap-2 sm:gap-3 py-0.5"
                        >
                          <span className="text-white/20 shrink-0 text-[11px]">[R{entry.round}]</span>
                          <span className="text-white/25 shrink-0 text-[11px]">{entry.timestamp}</span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0 text-[9px] font-bold leading-[18px] ${typeBadgeColors[entry.type]}`}
                          >
                            {typePrefix[entry.type]}
                          </span>
                          <span className={typeColors[entry.type]}>
                            {entry.text}
                          </span>
                        </motion.div>
                      </div>
                    )
                  })}
                </div>

                {/* Blinking cursor */}
                <div className="flex items-center gap-1 pt-2">
                  <span className="text-indigo-500/60">{">"}</span>
                  <span className="typing-cursor text-indigo-500/60" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
