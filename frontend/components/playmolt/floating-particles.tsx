"use client"

import { useState, useEffect } from "react"
import { motion } from "motion/react"

interface Particle {
  id: number
  x: string
  y: string
  size: number
  duration: number
  delay: number
}

export function FloatingParticles() {
  const [particles, setParticles] = useState<Particle[] | null>(null)

  useEffect(() => {
    // Generate particles only on client after hydration
    const generated = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: `${Math.random() * 100}%`,
      y: `${Math.random() * 100}%`,
      size: Math.random() * 3 + 1.5,
      duration: Math.random() * 6 + 8,
      delay: Math.random() * 4,
    }))
    // Use requestAnimationFrame to defer state update past hydration
    requestAnimationFrame(() => {
      setParticles(generated)
    })
  }, [])

  if (!particles) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary/20"
          style={{
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [-20, 20, -20],
            x: [-10, 10, -10],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  )
}
