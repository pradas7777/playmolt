"use client"

import { useEffect, useState, useMemo } from "react"
import { motion } from "motion/react"
import type { Topic } from "./agora-data"
import { getTempColor } from "./agora-data"

function sizeFromCount(count: number) {
  if (count >= 10) return 110
  if (count >= 5) return 80
  if (count >= 1) return 56
  return 40
}

// Simple circle packing: place bubbles without overlap
function packBubbles(topics: Topic[], width: number, height: number) {
  const placed: { x: number; y: number; r: number; topic: Topic }[] = []
  const sorted = [...topics].sort((a, b) => b.agentCount - a.agentCount)

  for (const topic of sorted) {
    const r = sizeFromCount(topic.agentCount) / 2
    let bestX = width / 2
    let bestY = height / 2
    let placed_ = false

    // Try center first, then spiral outward
    for (let attempt = 0; attempt < 200; attempt++) {
      const angle = attempt * 0.5
      const dist = attempt * 2
      const cx = width / 2 + Math.cos(angle) * dist
      const cy = height / 2 + Math.sin(angle) * dist

      if (cx - r < 0 || cx + r > width || cy - r < 0 || cy + r > height) continue

      const overlaps = placed.some((p) => {
        const dx = p.x - cx
        const dy = p.y - cy
        return Math.sqrt(dx * dx + dy * dy) < p.r + r + 8
      })

      if (!overlaps) {
        bestX = cx
        bestY = cy
        placed_ = true
        break
      }
    }

    if (!placed_) {
      bestX = Math.random() * (width - r * 2) + r
      bestY = Math.random() * (height - r * 2) + r
    }

    placed.push({ x: bestX, y: bestY, r, topic })
  }

  return placed
}

export function BubbleChart({
  topics,
  onBubbleClick,
}: {
  topics: Topic[]
  onBubbleClick: (id: string) => void
}) {
  const [dims, setDims] = useState({ w: 800, h: 280 })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const update = () => {
      const w = Math.min(window.innerWidth - 48, 1100)
      setDims({ w, h: 280 })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const bubbles = useMemo(
    () => packBubbles(topics, dims.w, dims.h),
    [topics, dims.w, dims.h]
  )

  if (!mounted) return <div className="h-[280px]" />

  return (
    <div className="relative hidden md:block" style={{ width: dims.w, height: dims.h, margin: "0 auto" }}>
      {bubbles.map(({ x, y, r, topic }, i) => {
        const color = getTempColor(topic.agentCount)
        return (
          <motion.button
            key={topic.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: 1,
              opacity: 1,
              y: [0, -4, 0, 4, 0],
            }}
            transition={{
              scale: { type: "spring", stiffness: 300, damping: 20, delay: i * 0.06 },
              y: { duration: 3 + Math.random() * 2, repeat: Infinity, ease: "easeInOut", delay: Math.random() * 2 },
            }}
            whileHover={{ scale: 1.12 }}
            onClick={() => onBubbleClick(topic.id)}
            className="absolute flex flex-col items-center justify-center rounded-full border border-white/10 text-center leading-tight cursor-pointer"
            style={{
              left: x - r,
              top: y - r,
              width: r * 2,
              height: r * 2,
              background: `${color}22`,
              boxShadow: `0 0 20px ${color}33`,
            }}
            title={`${topic.title} - ${topic.category}`}
          >
            <span
              className="font-bold drop-shadow-sm"
              style={{
                fontSize: r > 40 ? 11 : 9,
                color,
                maxWidth: r * 1.6,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {topic.title.length > (r > 40 ? 18 : 10)
                ? topic.title.slice(0, r > 40 ? 16 : 8) + "..."
                : topic.title}
            </span>
            <span className="text-[9px] font-mono opacity-70" style={{ color }}>
              {topic.agentCount}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
