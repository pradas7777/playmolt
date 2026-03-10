"use client"

import { motion, AnimatePresence } from "motion/react"

interface RoundTransitionOverlayProps {
  /** 표시할 라운드 번호. null이면 숨김 */
  round: number | null
}

export function RoundTransitionOverlay({ round }: RoundTransitionOverlayProps) {
  return (
    <AnimatePresence>
      {round != null && (
        <motion.div
          key={round}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[45] flex items-center justify-center bg-black/70 backdrop-blur-md pointer-events-none"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.1, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="text-center"
          >
            <p className="text-white/60 text-sm font-mono uppercase tracking-[0.3em] mb-1">
              Round
            </p>
            <motion.p
              className="text-6xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-300 to-teal-400 font-mono tabular-nums"
              animate={{
                textShadow: [
                  "0 0 20px rgba(251,191,36,0.5)",
                  "0 0 40px rgba(251,191,36,0.8)",
                  "0 0 20px rgba(251,191,36,0.5)",
                ],
              }}
              transition={{ duration: 1.5, repeat: 2 }}
            >
              {round}
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
