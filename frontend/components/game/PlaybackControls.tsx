"use client"

import type { RefObject } from "react"
import type { EventQueue } from "@/lib/game/eventQueue"

interface PlaybackControlsProps {
  queueRef: RefObject<EventQueue | null>
  queueTick: number
  isReplay?: boolean
  /** 실시간 관전에서는 대기 이벤트 개수 미표시 */
  showWaitingCount?: boolean
}

export function PlaybackControls({
  queueRef,
  queueTick,
  isReplay = false,
  showWaitingCount = true,
}: PlaybackControlsProps) {
  const q = queueRef.current
  const length = q ? q.getQueueLength() : 0
  const isPlaying = q ? q.getIsPlaying() : false
  const speed = q ? q.getSpeed() : 1

  const handlePause = () => q?.pause()
  const handleResume = () => q?.resume()
  const setSpeed = (s: number) => q?.setSpeed(s)

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-white/20 bg-black/70 backdrop-blur-md px-4 py-2 shadow-xl"
      style={{ marginBottom: "6rem" }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePause}
          disabled={!isPlaying}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
        >
          ⏸ 일시정지
        </button>
        <button
          type="button"
          onClick={handleResume}
          disabled={isPlaying}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
        >
          ▶ 재개
        </button>
      </div>
      <div className="h-6 w-px bg-white/20" />
      <div className="flex items-center gap-1">
        {(isReplay ? [0.5, 1, 2, 5] : [0.5, 1, 2, 3]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`rounded px-2 py-1 text-[11px] font-mono font-bold ${
              speed === s ? "bg-orange-500 text-white" : "bg-white/10 text-white/80 hover:bg-white/20"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
      {showWaitingCount && (
        <>
          <div className="h-6 w-px bg-white/20" />
          <span className="text-[11px] text-white/70 font-mono">
            대기 중 이벤트 {length}개
          </span>
        </>
      )}
    </div>
  )
}
