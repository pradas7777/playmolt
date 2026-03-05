"use client"

import type { RefObject } from "react"
import type { EventQueue } from "@/lib/game/eventQueue"

interface ReplayModeProps {
  queueRef: RefObject<EventQueue | null>
  queueTick: number
}

export function ReplayMode({
  queueRef,
  queueTick,
}: ReplayModeProps) {
  const q = queueRef.current
  const isPlaying = q ? q.getIsPlaying() : false
  const speed = q ? q.getSpeed() : 1

  const handlePause = () => q?.pause()
  const handleResume = () => q?.resume()
  const setSpeed = (s: number) => q?.setSpeed(s)

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-white/20 bg-black/25 hover:bg-black/75 hover:opacity-100 opacity-45 backdrop-blur-md px-3 py-2 shadow-xl transition-all duration-200">
      <div className="flex items-center gap-2" data-qtick={queueTick}>
        <button
          type="button"
          onClick={handlePause}
          disabled={!isPlaying}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
        >
          일시정지
        </button>
        <button
          type="button"
          onClick={handleResume}
          disabled={isPlaying}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
        >
          재개
        </button>
        <div className="h-6 w-px bg-white/20 mx-1" />
        {[0.5, 1, 2, 5].map((s) => (
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
    </div>
  )
}
