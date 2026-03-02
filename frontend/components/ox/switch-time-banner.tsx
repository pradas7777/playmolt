"use client"

import { motion, AnimatePresence } from "motion/react"
import { useEffect, useState } from "react"

interface SwitchTimeBannerProps {
  active: boolean
  countdown: number
  onCountdownEnd?: () => void
}

export function SwitchTimeBanner({ active, countdown: initialCountdown, onCountdownEnd }: SwitchTimeBannerProps) {
  const [countdown, setCountdown] = useState(initialCountdown)

  useEffect(() => {
    setCountdown(initialCountdown)
  }, [initialCountdown])

  useEffect(() => {
    if (!active || countdown <= 0) return
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          onCountdownEnd?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [active, countdown, onCountdownEnd])

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: -60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="absolute inset-x-0 top-[12%] z-40 flex flex-col items-center pointer-events-none"
        >
          {/* Darken overlay */}
          <motion.div
            className="fixed inset-0 bg-black/30 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Banner */}
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="relative z-50 rounded-2xl border border-yellow-500/40 bg-black/70 backdrop-blur-xl px-8 py-4 shadow-2xl"
            style={{ boxShadow: "0 0 40px 8px rgba(234,179,8,0.2)" }}
          >
            <motion.p
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="text-center text-xl sm:text-2xl font-black text-yellow-400 tracking-wider font-mono"
            >
              {"SWITCH TIME!"}
            </motion.p>
            <motion.p
              key={countdown}
              initial={{ scale: 1.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-2 text-center text-4xl sm:text-5xl font-black text-white font-mono tabular-nums"
            >
              {countdown}
            </motion.p>
            <p className="mt-1 text-center text-[10px] text-white/50 font-mono uppercase tracking-widest">
              Agents may switch sides
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
