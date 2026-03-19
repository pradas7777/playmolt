"use client"

import { motion, AnimatePresence } from "motion/react"

export type RoundEventType = "ATTACK" | "DEFEND" | "CHARGE" | "DEATH" | "GAS" | "ROUND_END"

export interface RoundEvent {
  id: string
  round: number
  timestamp: string
  text: string
  type: RoundEventType
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

export interface RoundLogPanelProps {
  events: RoundEvent[]
  /** 실시간 관전: 현재 라운드. 이 라운드에 액션 로그가 없으면 "ROUND N : 에이전트들 생각중...." 표시 */
  currentRound?: number
}

export function RoundLogPanel({ events, currentRound }: RoundLogPanelProps) {
  let lastRound = -1
  const hasEventsForCurrentRound =
    currentRound != null && currentRound > 0 && events.some((e) => e.round === currentRound)
  const showThinkingPlaceholder =
    currentRound != null && currentRound > 0 && !hasEventsForCurrentRound

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-[320px] rounded-xl border border-white/10 bg-[#0a0a0a] backdrop-blur-lg shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-white/5 bg-[#1a1a1a]">
        <span className="font-mono text-[11px] text-white/40">● ROUND LOG</span>
      </div>
      <div className="p-3 font-mono text-xs max-h-[320px] overflow-y-auto scrollbar-hide">
        <div className="flex flex-col gap-0.5">
          <AnimatePresence>
            {events.map((entry, i) => {
              const showDivider = entry.round !== lastRound
              lastRound = entry.round
              return (
                <div key={entry.id ? String(entry.id) : `event-${entry.round}-${i}`}>
                  {showDivider && (
                    <div className="flex items-center gap-2 my-1.5">
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
                    transition={{ duration: 0.2, delay: i * 0.02 }}
                    className="flex items-start gap-2 py-0.5"
                  >
                    <span className="text-white/20 shrink-0 text-[11px]">[R{entry.round}]</span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0 text-[9px] font-bold leading-[18px] ${typeBadgeColors[entry.type] || "bg-white/5 text-white/50 border-white/10"}`}
                    >
                      {entry.type}
                    </span>
                    <span
                      className={`${typeColors[entry.type] || "text-white/70"} ${entry.type === "DEATH" ? "line-through" : ""}`}
                    >
                      <span className="font-sans">{entry.text}</span>
                    </span>
                  </motion.div>
                </div>
              )
            })}
            {showThinkingPlaceholder && (
              <motion.div
                key={`round-${currentRound}-divider`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 my-1.5 pt-1"
              >
                <span className="flex-1 border-t border-white/10" />
                <span className="text-[10px] uppercase tracking-widest text-white/25 font-bold">
                  Round {currentRound}
                </span>
                <span className="flex-1 border-t border-white/10" />
              </motion.div>
            )}
            {showThinkingPlaceholder && (
              <motion.div
                key={`round-${currentRound}-thinking`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-start gap-2 py-0.5 text-white/50 italic"
              >
                <span className="shrink-0 text-[11px]">[R{currentRound}]</span>
                <span>ROUND {currentRound} : 에이전트들 생각중....</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
