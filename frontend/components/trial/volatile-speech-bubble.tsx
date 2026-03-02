"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"

interface VolatileSpeechBubbleProps {
  agentName: string
  text: string
  role: "JUDGE" | "PROSECUTOR" | "DEFENSE" | "JUROR"
  /** Where the tail points: right-of-card or left-of-card or above-card */
  position: "right" | "left" | "top"
  visible: boolean
}

function TypewriterText({ text, speed = 35 }: { text: string; speed?: number }) {
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
        <span className="animate-pulse text-neutral-400">|</span>
      )}
    </span>
  )
}

const roleColors: Record<string, string> = {
  JUDGE: "text-violet-400",
  PROSECUTOR: "text-rose-400",
  DEFENSE: "text-sky-400",
  JUROR: "text-amber-400",
}

const roleBadgeColors: Record<string, string> = {
  JUDGE: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  PROSECUTOR: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  DEFENSE: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  JUROR: "bg-amber-500/20 text-amber-300 border-amber-500/30",
}

export function VolatileSpeechBubble({
  agentName,
  text,
  role,
  position,
  visible,
}: VolatileSpeechBubbleProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7, y: position === "top" ? 10 : 0, x: position === "right" ? -10 : position === "left" ? 10 : 0 }}
          animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: position === "top" ? -6 : -4 }}
          transition={{
            duration: 0.3,
            type: "spring",
            stiffness: 350,
            damping: 25,
          }}
          className={`flex flex-col ${
            position === "left" ? "items-end" : position === "right" ? "items-start" : "items-center"
          }`}
        >
          {/* Speaker name badge */}
          <span className={`text-[8px] font-mono font-bold mb-0.5 px-2 py-0 rounded-full border ${roleBadgeColors[role]}`}>
            {agentName}
          </span>

          {/* Bubble */}
          <div className="relative max-w-[180px] sm:max-w-[220px]">
            <div className="rounded-2xl bg-cream-50 bg-white/90 border border-white/20 px-3 py-2 shadow-lg shadow-black/20">
              <p className="text-xs sm:text-[13px] font-sans leading-relaxed text-neutral-800">
                <TypewriterText text={text} speed={30} />
              </p>
            </div>

            {/* Tail */}
            {position === "left" && (
              <div
                className="absolute top-3 -right-2 w-0 h-0"
                style={{
                  borderTop: "5px solid transparent",
                  borderBottom: "5px solid transparent",
                  borderLeft: "7px solid rgba(255,255,255,0.9)",
                }}
              />
            )}
            {position === "right" && (
              <div
                className="absolute top-3 -left-2 w-0 h-0"
                style={{
                  borderTop: "5px solid transparent",
                  borderBottom: "5px solid transparent",
                  borderRight: "7px solid rgba(255,255,255,0.9)",
                }}
              />
            )}
            {position === "top" && (
              <div
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "7px solid rgba(255,255,255,0.9)",
                }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
