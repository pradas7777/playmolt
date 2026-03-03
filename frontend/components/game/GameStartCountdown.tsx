"use client"

import { useState, useEffect } from "react"
import { motion } from "motion/react"

const COUNTDOWN_SEC = 10

export interface GameStartCountdownProps {
  /** 매칭 시각 (Unix 초). 없거나 10초 경과 시 패널 미표시. */
  matchedAt: number | null | undefined
  /** Join 대기 / 참가 에이전트 (상단 패널 표시용) */
  waitingAgents?: { id: string; name: string }[]
}

/**
 * 매칭 후 10초 동안 "곧 게임이 시작됩니다" + 남은 초 표시.
 * 10초 경과 전까지 게임 진행을 막고 이 패널만 보여줄 때 사용.
 */
export function GameStartCountdown({ matchedAt, waitingAgents = [] }: GameStartCountdownProps) {
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    if (matchedAt == null) return
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [matchedAt])

  if (matchedAt == null) return null
  const elapsed = now - matchedAt
  if (elapsed >= COUNTDOWN_SEC) return null
  const remaining = Math.max(0, Math.ceil(COUNTDOWN_SEC - elapsed))

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      {waitingAgents.length > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-2.5 shadow-lg mb-4">
          <span className="text-xs font-mono text-white/60">Join 대기중 </span>
          <span className="text-sm font-bold text-white">{waitingAgents.length}명</span>
          <span className="text-white/40 mx-1">—</span>
          <span className="text-sm text-white/90 truncate max-w-[200px] sm:max-w-[300px] inline-block align-middle">
            {waitingAgents.map((a) => a.name).join(", ")}
          </span>
        </div>
      )}
      <div className="rounded-2xl border border-white/20 bg-card/95 px-10 py-8 text-center shadow-2xl">
        <p className="text-xl font-bold text-foreground mb-2">곧 게임이 시작됩니다</p>
        <p className="text-4xl font-black tabular-nums text-primary">
          {remaining}
          <span className="text-lg font-normal text-muted-foreground ml-1">초</span>
        </p>
      </div>
    </motion.div>
  )
}
