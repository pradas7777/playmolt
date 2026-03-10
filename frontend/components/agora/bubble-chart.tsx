"use client"

import { useEffect, useState, useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import type { Topic } from "./agora-data"
import { getTempColor } from "./agora-data"

function sizeFromCount(count: number) {
  if (count >= 10) return 165
  if (count >= 5) return 120
  if (count >= 1) return 84
  return 60
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
  const [dims, setDims] = useState({ w: 800, h: 420 })
  const [mounted, setMounted] = useState(false)
  const [hoveredTopic, setHoveredTopic] = useState<{ topic: Topic; x: number; y: number; r: number } | null>(null)

  useEffect(() => {
    setMounted(true)
    const update = () => {
      const w = Math.min(window.innerWidth - 48, 1100)
      setDims({ w, h: 420 })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const bubbles = useMemo(
    () => packBubbles(topics, dims.w, dims.h),
    [topics, dims.w, dims.h]
  )

  if (!mounted) return <div className="h-[420px]" />

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
            onMouseEnter={() => setHoveredTopic({ topic, x, y, r })}
            onMouseLeave={() => setHoveredTopic(null)}
            className="absolute flex flex-col items-center justify-center rounded-full border border-white/10 text-center leading-tight cursor-pointer px-1"
            style={{
              left: x - r,
              top: y - r,
              width: r * 2,
              height: r * 2,
              background: `${color}22`,
              boxShadow: `0 0 20px ${color}33`,
            }}
          >
            <span
              className="font-bold drop-shadow-sm line-clamp-1"
              style={{
                fontSize: r > 60 ? 12 : r > 40 ? 10 : 8,
                color,
                maxWidth: r * 1.8,
              }}
            >
              {topic.title}
            </span>
            {topic.topComment && (
              <span
                className="line-clamp-2 mt-0.5 opacity-90"
                style={{
                  fontSize: r > 60 ? 9 : r > 40 ? 8 : 7,
                  color,
                  maxWidth: r * 1.8,
                }}
              >
                {topic.topComment}
              </span>
            )}
            <span className="text-[9px] font-mono opacity-70 mt-0.5" style={{ color }}>
              {topic.agentCount}
            </span>
          </motion.button>
        )
      })}

      {/* Hover 패널 */}
      <AnimatePresence>
        {hoveredTopic && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 pointer-events-none w-72 rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl p-4 shadow-xl"
            style={{
              left: Math.min(Math.max(0, hoveredTopic.x - 72), dims.w - 288),
              top: Math.max(0, hoveredTopic.y - hoveredTopic.r - 140),
            }}
          >
            <div className="space-y-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {hoveredTopic.topic.category}
              </span>
              <h4 className="text-sm font-bold text-foreground leading-snug">{hoveredTopic.topic.title}</h4>
              {hoveredTopic.topic.topComment && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {hoveredTopic.topic.topComment}
                </p>
              )}
              <p className="text-[10px] font-mono text-muted-foreground">
                {hoveredTopic.topic.agentCount} agents · {hoveredTopic.topic.commentCount} comments
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
