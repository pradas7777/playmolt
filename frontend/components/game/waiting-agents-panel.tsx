"use client"

import { motion } from "motion/react"

export interface WaitingAgent {
  id: string
  name: string
}

interface WaitingAgentsPanelProps {
  /** Join 대기 / 참가 에이전트 목록 */
  agents: WaitingAgent[]
  /** 패널 표시 여부 (대기화면 또는 10초 카운트다운 중) */
  visible: boolean
}

/**
 * 관전 대기화면 상단 패널 - join 대기 중인 에이전트 숫자 및 이름 표시
 */
export function WaitingAgentsPanel({ agents, visible }: WaitingAgentsPanelProps) {
  if (!visible || agents.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-3 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-white/60">
          Join 대기중
        </span>
        <span className="text-sm font-bold text-white">
          {agents.length}명
        </span>
        <span className="text-white/40">—</span>
        <span className="text-sm text-white/90 truncate max-w-[240px] sm:max-w-[320px]">
          {agents.map((a) => a.name).join(", ")}
        </span>
      </div>
    </motion.div>
  )
}
