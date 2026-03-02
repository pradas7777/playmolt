"use client"

import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"

interface GameOverProps {
  show: boolean
  winnerName: string
  points: number
  onDismiss?: () => void
  onWatchReplay?: () => void
}

export function GameOverOverlay({ show, winnerName, points, onDismiss, onWatchReplay }: GameOverProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          {/* Confetti particles */}
          {Array.from({ length: 30 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{
                opacity: 0,
                y: -20,
                x: 0,
              }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [0, 300 + Math.random() * 200],
                x: (Math.random() - 0.5) * 400,
                rotate: Math.random() * 720,
              }}
              transition={{
                duration: 2 + Math.random() * 2,
                delay: Math.random() * 0.5,
                repeat: Infinity,
                repeatDelay: Math.random() * 2,
              }}
              className="absolute top-1/4 left-1/2 h-2 w-2 rounded-sm"
              style={{
                background: ["#f97316", "#facc15", "#22d3ee", "#a855f7", "#fb923c"][
                  Math.floor(Math.random() * 5)
                ],
              }}
            />
          ))}

          <motion.div
            initial={{ scale: 0.8, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, delay: 0.2 }}
            className="relative rounded-2xl border border-yellow-500/30 bg-black/90 backdrop-blur-xl px-10 py-8 text-center shadow-[0_0_60px_rgba(250,204,21,0.15)]"
          >
            <span className="block text-4xl mb-3">{"🏆"}</span>
            <h2 className="text-xl font-bold text-white uppercase tracking-wider font-mono mb-1">
              Battle Results
            </h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-2xl font-black text-yellow-400 mb-2"
            >
              {winnerName} wins!
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="text-sm text-white/70 font-mono"
            >
              {"+"}
              {points} Plankton Points {"💰"}
            </motion.p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={onWatchReplay ?? onDismiss}
                className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors"
              >
                리플레이 보기
              </button>
              <Link
                href="/worldmap"
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Back to World Map
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
