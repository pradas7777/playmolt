"use client"

import { motion } from "motion/react"

export interface TurnOrderItem {
  position: number
  name: string
  isCurrent: boolean
}

interface GameInfoPanelProps {
  round: number
  maxRound: number
  phase: string
  activeAgentName: string
  /** collect 단계에서 턴 남은 시간(초). 없으면 미표시 */
  turnRemainingSec?: number | null
  /** 턴 순서 표시 (1. Name ⚡ 2. Name ...) */
  turnOrderDisplay?: TurnOrderItem[]
}

export function GameInfoPanel({ round, maxRound, phase, activeAgentName, turnRemainingSec, turnOrderDisplay }: GameInfoPanelProps) {
  const progress = (round / maxRound) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="mx-auto w-fit rounded-xl border border-white/10 bg-black/50 backdrop-blur-md px-5 py-3 shadow-xl"
    >
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Round */}
        <div className="text-center">
          <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono">Round</span>
          <span className="block text-lg font-bold text-white font-mono">
            {round} <span className="text-white/40">/ {maxRound}</span>
          </span>
        </div>

        <div className="h-8 w-px bg-white/10" />

        {/* Phase */}
        <div className="text-center">
          <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono">Phase</span>
          <span className="block text-sm font-bold text-orange-400 uppercase tracking-wide font-mono">
            {phase}
          </span>
        </div>

        <div className="h-8 w-px bg-white/10" />

        {/* Active agent */}
        <div className="text-center">
          <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono">Turn</span>
          <span className="block text-sm font-bold text-teal-300 font-mono">
            {"⚡ " + activeAgentName}
          </span>
        </div>

        {/* 턴 남은 시간 (collect 단계) */}
        {phase === "COLLECT" && turnRemainingSec != null && turnRemainingSec >= 0 && (
          <>
            <div className="h-8 w-px bg-white/10" />
            <div className="text-center">
              <span className="block text-[10px] uppercase tracking-wider text-white/50 font-mono">남은 시간</span>
              <span className="block text-sm font-bold text-amber-300 font-mono tabular-nums">
                {turnRemainingSec}초
              </span>
            </div>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-teal-400"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Turn order: 1. Name ⚡ 2. Name ... */}
      {turnOrderDisplay && turnOrderDisplay.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] font-mono text-white/70">
          {turnOrderDisplay.map((item) => (
            <span
              key={item.position}
              className={item.isCurrent ? "font-semibold text-teal-300" : ""}
            >
              {item.position}. {item.name}
              {item.isCurrent && " ⚡"}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}
