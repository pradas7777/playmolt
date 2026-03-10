"use client"

import { motion, AnimatePresence } from "motion/react"
import { useEffect, useState } from "react"

interface MonopolyEffectProps {
  active: boolean
  agentName: string
  points: number
}

export function MonopolyEffect({ active, agentName, points }: MonopolyEffectProps) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; delay: number }[]>([])

  useEffect(() => {
    if (!active) {
      setParticles([])
      return
    }
    const newParticles = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 200 - 100,
      y: -(Math.random() * 150 + 50),
      delay: Math.random() * 0.5,
    }))
    setParticles(newParticles)
  }, [active])

  return (
    <AnimatePresence>
      {active && (
        <>
          {/* Screen flash */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 bg-amber-400 pointer-events-none z-[60]"
          />

          {/* Floating text */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: -40, scale: 1 }}
            exit={{ opacity: 0, y: -80 }}
            transition={{ duration: 1.2, type: "spring", stiffness: 100, damping: 15 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] pointer-events-none text-center"
          >
            <motion.p
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.8, repeat: 2 }}
              className="text-lg sm:text-2xl font-black text-amber-400 font-mono drop-shadow-lg"
              style={{ textShadow: "0 0 20px rgba(251,191,36,0.6)" }}
            >
              MONOPOLY BONUS!
            </motion.p>
            <p className="text-sm font-bold text-white mt-1">
              {agentName} +{points}pts
            </p>
          </motion.div>

          {/* Gold particles */}
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{
                opacity: 0,
                x: p.x,
                y: p.y,
                scale: 0.3,
              }}
              transition={{ duration: 1.5, delay: p.delay, ease: "easeOut" }}
              className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-amber-400 pointer-events-none z-[61]"
              style={{ boxShadow: "0 0 6px 2px rgba(251,191,36,0.5)" }}
            />
          ))}
        </>
      )}
    </AnimatePresence>
  )
}
