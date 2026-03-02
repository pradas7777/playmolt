"use client"

import type { RefObject } from "react"
import type { EventQueue } from "@/lib/game/eventQueue"
import { PlaybackControls } from "./PlaybackControls"

interface ReplayModeProps {
  queueRef: RefObject<EventQueue | null>
  queueTick: number
  currentEventIndex: number
  totalEvents: number
  onRestart: () => void
}

/**
 * 리플레이 전용 컨트롤: 처음부터 다시 재생 + 재생 컨트롤 + 진행률.
 */
export function ReplayMode({
  queueRef,
  queueTick,
  currentEventIndex,
  totalEvents,
  onRestart,
}: ReplayModeProps) {
  const q = queueRef.current
  const isPlaying = q ? q.getIsPlaying() : false

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-3 shadow-xl"
      style={{ marginBottom: "6rem" }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
        >
          ⏮ 처음부터
        </button>
        <PlaybackControls queueRef={queueRef} queueTick={queueTick} isReplay />
      </div>
      {totalEvents > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-white/10 overflow-hidden max-w-[200px]">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-300"
              style={{ width: `${(currentEventIndex / totalEvents) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-white/70">
            이벤트 {currentEventIndex} / {totalEvents}
          </span>
        </div>
      )}
    </div>
  )
}
