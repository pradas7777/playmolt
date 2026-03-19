"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "motion/react"

export interface BattleLogEntry {
  round: number
  timestamp: string
  text: string
  type: "ATTACK" | "DEFEND" | "CHARGE" | "DEATH" | "GAS" | "ROUND_END"
}

const typeColors: Record<string, string> = {
  ATTACK: "text-orange-400",
  DEFEND: "text-blue-400",
  CHARGE: "text-teal-400",
  DEATH: "text-red-400",
  GAS: "text-purple-400",
  ROUND_END: "text-white/30",
}

const typeBadgeColors: Record<string, string> = {
  ATTACK: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  DEFEND: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CHARGE: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  DEATH: "bg-red-500/20 text-red-400 border-red-500/30",
  GAS: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ROUND_END: "bg-white/5 text-white/30 border-white/10",
}

export function BattleTerminalLog({ logs }: { logs: BattleLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, paused])

  // Group by round for dividers
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
                {"● BATTLE LOG — Game #1042"}
              </span>
            </div>

            {/* Scanline overlay */}
            <div className="relative">
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,100,0.012) 2px, rgba(0,255,100,0.012) 4px)",
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
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0 text-[9px] font-bold leading-[18px] ${typeBadgeColors[entry.type]}`}
                          >
                            {entry.type}
                          </span>
                          <span
                            className={`${typeColors[entry.type]} ${
                              entry.type === "DEATH" ? "line-through" : ""
                            }`}
                          >
                            <span className="font-sans">{entry.text}</span>
                          </span>
                        </motion.div>
                      </div>
                    )
                  })}
                </div>

                {/* Blinking cursor */}
                <div className="flex items-center gap-1 pt-2">
                  <span className="text-green-500/60">{">"}</span>
                  <span className="typing-cursor text-green-500/60" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
