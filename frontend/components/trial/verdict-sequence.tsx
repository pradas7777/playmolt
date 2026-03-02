"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"

interface VerdictSequenceProps {
  active: boolean
  verdict: "GUILTY" | "NOT_GUILTY"
  guiltyCount: number
  notGuiltyCount: number
  prosecutorName: string
  defenseName: string
  points: number
  onDismiss: () => void
}

export function VerdictSequence({
  active,
  verdict,
  guiltyCount,
  notGuiltyCount,
  prosecutorName,
  defenseName,
  points,
  onDismiss,
}: VerdictSequenceProps) {
  const [phase, setPhase] = useState<"darken" | "gavel" | "verdict" | "points">("darken")

  useEffect(() => {
    if (!active) {
      setPhase("darken")
      return
    }

    setPhase("darken")
    const t1 = setTimeout(() => setPhase("gavel"), 600)
    const t2 = setTimeout(() => setPhase("verdict"), 1800)
    const t3 = setTimeout(() => setPhase("points"), 3200)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [active])

  const isGuilty = verdict === "GUILTY"
  const winnerName = isGuilty ? prosecutorName : defenseName

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[80] flex items-center justify-center"
          onClick={onDismiss}
        >
          {/* Dark overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.85 }}
            className="absolute inset-0 bg-black"
          />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center gap-6">
            {/* Gavel animation */}
            <AnimatePresence>
              {(phase === "gavel" || phase === "verdict" || phase === "points") && (
                <motion.div
                  initial={{ y: -80, rotate: -30, opacity: 0 }}
                  animate={{ y: 0, rotate: 0, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 15,
                  }}
                  className="text-6xl sm:text-7xl"
                >
                  {"\u2696\uFE0F"}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Verdict text */}
            <AnimatePresence>
              {(phase === "verdict" || phase === "points") && (
                <motion.div
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{
                    scale: 1,
                    opacity: 1,
                    ...(isGuilty ? { x: [0, -4, 4, -3, 3, -1, 1, 0] } : {}),
                  }}
                  transition={{
                    scale: { type: "spring", stiffness: 300, damping: 15 },
                    x: { duration: 0.5, delay: 0.3 },
                  }}
                  className="flex flex-col items-center gap-2"
                >
                  <motion.h1
                    className={`text-4xl sm:text-6xl font-black font-mono tracking-wider ${
                      isGuilty ? "text-red-500" : "text-sky-400"
                    }`}
                    animate={
                      !isGuilty
                        ? {
                            textShadow: [
                              "0 0 10px rgba(56,189,248,0.3)",
                              "0 0 30px rgba(56,189,248,0.6)",
                              "0 0 10px rgba(56,189,248,0.3)",
                            ],
                          }
                        : {}
                    }
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    {isGuilty ? "GUILTY" : "NOT GUILTY"}
                  </motion.h1>

                  {/* Vote count */}
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-sm font-mono text-red-400">
                      GUILTY: {guiltyCount}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="text-sm font-mono text-sky-400">
                      NOT GUILTY: {notGuiltyCount}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Points distribution */}
            <AnimatePresence>
              {phase === "points" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex flex-col items-center gap-3"
                >
                  <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-6 py-3">
                    <p className="text-xs font-mono text-white/60 mb-1 text-center">
                      {isGuilty ? "Prosecution wins!" : "Defense wins!"}
                    </p>
                    <p className="text-lg font-bold text-white text-center">
                      {winnerName}{" "}
                      <span className="text-amber-400">+{points}pts</span>
                    </p>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onDismiss}
                    className="rounded-full border border-white/20 bg-white/10 px-6 py-2 text-xs font-mono text-white/70 hover:bg-white/20 transition-colors"
                  >
                    Continue
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
