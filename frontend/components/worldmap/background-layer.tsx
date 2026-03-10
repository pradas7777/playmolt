"use client"

import { motion } from "motion/react"
import Image from "next/image"

function Particle({
  delay,
  size,
  color,
  x,
  y,
  duration,
}: {
  delay: number
  size: number
  color: string
  x: string
  y: string
  duration: number
}) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size,
        height: size,
        background: color,
        left: x,
        top: y,
        opacity: 0.4,
        willChange: "transform, opacity",
        filter: "blur(0.2px)",
      }}
      animate={{
        y: [0, -18, 8, -12, 0],
        x: [0, 10, -8, 6, 0],
        opacity: [0.4, 0.95, 0.7, 0.9, 0.4],
        scale: [1, 1.15, 0.95, 1.1, 1],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  )
}

const particles = [
  { delay: 0, size: 4, color: "#5eead4", x: "10%", y: "20%", duration: 5 },
  { delay: 0.2, size: 6, color: "#f97316", x: "85%", y: "15%", duration: 5.5 },
  { delay: 0.4, size: 3, color: "#facc15", x: "40%", y: "80%", duration: 5.2 },
  { delay: 0.6, size: 5, color: "#a855f7", x: "70%", y: "60%", duration: 5.8 },
  { delay: 0.8, size: 4, color: "#5eead4", x: "25%", y: "45%", duration: 6 },
  { delay: 0.1, size: 7, color: "#f97316", x: "55%", y: "30%", duration: 5.3 },
  { delay: 0.3, size: 3, color: "#facc15", x: "90%", y: "70%", duration: 5.6 },
  { delay: 0.5, size: 5, color: "#a855f7", x: "15%", y: "75%", duration: 5.4 },
  { delay: 0.7, size: 4, color: "#5eead4", x: "60%", y: "10%", duration: 5.7 },
  { delay: 0.9, size: 6, color: "#f97316", x: "35%", y: "55%", duration: 5.1 },
  { delay: 0.15, size: 3, color: "#facc15", x: "80%", y: "40%", duration: 5.9 },
  { delay: 0.35, size: 5, color: "#a855f7", x: "50%", y: "90%", duration: 5.2 },
  { delay: 0.55, size: 4, color: "#5eead4", x: "5%", y: "60%", duration: 5.5 },
  { delay: 0.75, size: 6, color: "#facc15", x: "45%", y: "25%", duration: 5.4 },
  { delay: 0.95, size: 3, color: "#f97316", x: "75%", y: "85%", duration: 5.6 },
  { delay: 0.25, size: 5, color: "#a855f7", x: "20%", y: "35%", duration: 5.3 },
  { delay: 0.45, size: 4, color: "#5eead4", x: "65%", y: "50%", duration: 5.8 },
  { delay: 0.65, size: 6, color: "#facc15", x: "30%", y: "70%", duration: 5.1 },
  { delay: 0.85, size: 4, color: "#f97316", x: "95%", y: "45%", duration: 5.7 },
  { delay: 0.05, size: 5, color: "#a855f7", x: "8%", y: "85%", duration: 5.4 },
  { delay: 0.5, size: 3, color: "#5eead4", x: "72%", y: "22%", duration: 5.2 },
  { delay: 0.35, size: 6, color: "#facc15", x: "38%", y: "62%", duration: 5.6 },
  { delay: 0.65, size: 4, color: "#a855f7", x: "52%", y: "78%", duration: 5.3 },
]

export function BackgroundLayer() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Background image — slow parallax drift */}
      <motion.div
        className="absolute inset-0"
        style={{ willChange: "transform" }}
        animate={{
          // 너무 티 안 나게: 살짝 이동 + 아주 약한 회전 + 약간 줌인/아웃
          x: [0, -6, 4, -3, 0],
          y: [0, 4, -5, 3, 0],
          scale: [1.03, 1.04, 1.035, 1.045, 1.03],
          rotate: [0, 0.15, -0.12, 0.1, 0],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <Image
          src="/images/worldmap-bg-resize.jpg"
          alt="PlayMolt world map — paradise island with game arenas"
          fill
          className="object-cover"
          priority
          quality={70}
        />
      </motion.div>

      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/35" />

      {/* Glitch edge effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow:
            "inset 0 0 120px 26px rgba(168,85,247,0.10), inset 0 0 120px 26px rgba(94,234,212,0.08)",
        }}
      />

      {/* Floating particles */}
      {particles.map((p, i) => (
        <Particle key={i} {...p} />
      ))}
    </div>
  )
}