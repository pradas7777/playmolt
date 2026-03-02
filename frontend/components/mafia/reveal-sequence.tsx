"use client"

import { motion, AnimatePresence } from "motion/react"

interface RevealSequenceProps {
  active: boolean
  eliminatedName: string
  eliminatedRole: "WOLF" | "SHEEP"
  wolfWord: string
  sheepWord: string
  onDismiss: () => void
}

export function RevealSequence({
  active,
  eliminatedName,
  eliminatedRole,
  wolfWord,
  sheepWord,
  onDismiss,
}: RevealSequenceProps) {
  const wolfWins = eliminatedRole === "SHEEP"
  const winnerText = wolfWins
    ? "Wolf wins! Sheep failed to find the wolf"
    : "Sheep wins! Wolf eliminated!"

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[80] flex items-center justify-center"
          onClick={onDismiss}
        >
          {/* Dark overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black"
          />

          {/* Content */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 30 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
            className="relative z-10 flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl px-8 py-8 shadow-2xl max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Eliminated agent */}
            <motion.div
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.4, type: "spring", stiffness: 300, damping: 20 }}
              className="text-center"
            >
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2">
                Eliminated
              </p>
              <p className="text-2xl font-bold text-white">{eliminatedName}</p>
              <motion.span
                initial={{ scale: 0, filter: "blur(8px)" }}
                animate={{ scale: 1, filter: "blur(0px)" }}
                transition={{ delay: 0.8, duration: 0.4 }}
                className={`inline-block mt-2 rounded-full px-4 py-1 text-sm font-bold font-mono ${
                  eliminatedRole === "WOLF"
                    ? "bg-red-500/30 text-red-300 border border-red-500/40"
                    : "bg-green-500/30 text-green-300 border border-green-500/40"
                }`}
              >
                {eliminatedRole === "WOLF" ? "\uD83D\uDC3A WOLF" : "\uD83D\uDC11 SHEEP"}
              </motion.span>
            </motion.div>

            {/* Divider */}
            <div className="w-full h-px bg-white/10" />

            {/* Words revealed */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
              className="flex items-center gap-6"
            >
              <div className="text-center">
                <span className="block text-[10px] font-mono text-white/40 mb-1">Wolf word</span>
                <span className="text-xl font-bold text-red-400 font-mono">
                  {"\uD83D\uDC3A"} {wolfWord}
                </span>
              </div>
              <span className="text-white/20 text-lg">vs</span>
              <div className="text-center">
                <span className="block text-[10px] font-mono text-white/40 mb-1">Sheep word</span>
                <span className="text-xl font-bold text-white font-mono">
                  {"\uD83D\uDC11"} {sheepWord}
                </span>
              </div>
            </motion.div>

            {/* Winner announcement */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.6, type: "spring", stiffness: 200, damping: 15 }}
              className={`rounded-xl border px-6 py-3 text-center ${
                wolfWins
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-green-500/30 bg-green-500/10"
              }`}
            >
              <p
                className={`text-lg font-bold font-mono ${
                  wolfWins ? "text-red-300" : "text-green-300"
                }`}
              >
                {wolfWins ? "\uD83D\uDC3A" : "\uD83D\uDC11"} {winnerText}
              </p>
            </motion.div>

            {/* Points */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.0 }}
              className="flex gap-3"
            >
              <span className="text-[10px] font-mono text-white/30">
                Click anywhere to dismiss
              </span>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
