"use client"

import { motion } from "motion/react"
import Image from "next/image"

function Particle({ delay, size, color, x, y }: { delay: number; size: number; color: string; x: string; y: string }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{ width: size, height: size, background: color, left: x, top: y, opacity: 0 }}
      animate={{
        y: [0, -30, 10, -20, 0],
        x: [0, 15, -10, 5, 0],
        opacity: [0, 0.7, 0.4, 0.8, 0],
      }}
      transition={{
        duration: 8 + Math.random() * 4,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  )
}

const particles = [
  { delay: 0, size: 3, color: "#5eead4", x: "10%", y: "20%" },
  { delay: 0.5, size: 5, color: "#f97316", x: "85%", y: "15%" },
  { delay: 1, size: 2, color: "#facc15", x: "40%", y: "80%" },
  { delay: 1.5, size: 4, color: "#a855f7", x: "70%", y: "60%" },
  { delay: 2, size: 3, color: "#5eead4", x: "25%", y: "45%" },
  { delay: 2.5, size: 6, color: "#f97316", x: "55%", y: "30%" },
  { delay: 3, size: 2, color: "#facc15", x: "90%", y: "70%" },
  { delay: 0.3, size: 4, color: "#a855f7", x: "15%", y: "75%" },
  { delay: 1.2, size: 3, color: "#5eead4", x: "60%", y: "10%" },
  { delay: 1.8, size: 5, color: "#f97316", x: "35%", y: "55%" },
  { delay: 0.8, size: 2, color: "#facc15", x: "80%", y: "40%" },
  { delay: 2.2, size: 4, color: "#a855f7", x: "50%", y: "90%" },
  { delay: 3.2, size: 3, color: "#5eead4", x: "5%", y: "60%" },
  { delay: 0.7, size: 5, color: "#facc15", x: "45%", y: "25%" },
  { delay: 2.8, size: 2, color: "#f97316", x: "75%", y: "85%" },
]

export function BackgroundLayer() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Background image with wave drift */}
      <motion.div
        className="absolute inset-0"
        animate={{ y: [0, -8, 0, 8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <Image
          src="/images/worldmap-bg.jpg"
          alt="PlayMolt world map — paradise island with game arenas"
          fill
          className="object-cover"
          priority
          quality={75}
        />
      </motion.div>

      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Glitch edge effect */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 80px 20px rgba(168,85,247,0.08), inset 0 0 80px 20px rgba(94,234,212,0.06)",
        }}
      />

      {/* Particles */}
      {particles.map((p, i) => (
        <Particle key={i} {...p} />
      ))}
    </div>
  )
}
