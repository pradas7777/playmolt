"use client"

import { useState, useEffect } from "react"
import { motion } from "motion/react"

interface SpeechBubbleProps {
  agentName: string
  text: string
  side: "left" | "right"
  visible: boolean
  delay?: number
  isVote?: boolean
}

function TypewriterText({ text, speed = 40 }: { text: string; speed?: number }) {
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
        <span className="animate-pulse text-white/40">|</span>
      )}
    </span>
  )
}

export function SpeechBubble({
  agentName,
  text,
  side,
  visible,
  delay = 0,
  isVote = false,
}: SpeechBubbleProps) {
  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, delay, type: "spring", stiffness: 300, damping: 25 }}
      className={`flex flex-col ${side === "left" ? "items-start" : "items-end"}`}
    >
      {/* Agent name label */}
      <span className="text-[9px] font-mono font-bold text-white/50 mb-0.5 px-3">
        {agentName}
      </span>

      {/* Bubble */}
      <div className="relative max-w-[180px] sm:max-w-[220px]">
        <div
          className={`rounded-2xl border border-white/15 bg-white/10 backdrop-blur-md px-3 py-2 shadow-lg ${
            isVote ? "border-rose-400/30 bg-rose-500/10" : ""
          }`}
        >
          <p
            className={`text-xs sm:text-sm font-mono leading-relaxed ${
              isVote ? "text-rose-300" : "text-white/90"
            }`}
          >
            <TypewriterText text={text} speed={isVote ? 30 : 50} />
          </p>
        </div>

        {/* Tail */}
        <div
          className={`absolute top-3 ${
            side === "left" ? "-left-2" : "-right-2"
          } w-0 h-0`}
          style={{
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            ...(side === "left"
              ? { borderRight: "8px solid rgba(255,255,255,0.1)" }
              : { borderLeft: "8px solid rgba(255,255,255,0.1)" }),
          }}
        />
      </div>
    </motion.div>
  )
}
