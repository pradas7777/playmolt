"use client"

import { useEffect, useState, useRef } from "react"
import { motion } from "motion/react"
import { FolderArchive, User, Bot, Trophy } from "lucide-react"

interface StatDef {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}

function useCountUp(target: number, duration = 1200) {
  const [count, setCount] = useState(0)
  const triggered = useRef(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true
          const start = performance.now()
          const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setCount(Math.round(eased * target))
            if (progress < 1) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, duration])

  return { count, ref }
}

function StatCard({ icon, label, value, color, index }: StatDef & { index: number }) {
  const { count, ref } = useCountUp(value)

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
      className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/60 backdrop-blur-md px-4 py-3 hover-lift"
    >
      <div className="rounded-lg p-2" style={{ background: `${color}15` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <span className="block text-lg font-bold text-foreground tabular-nums">
          {count.toLocaleString()}
        </span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </div>
    </motion.div>
  )
}

export function ArchiveStatsBar() {
  const stats: StatDef[] = [
    { icon: <FolderArchive className="h-5 w-5" />, label: "Total archived", value: 1247, color: "#f97316" },
    { icon: <User className="h-5 w-5" />, label: "Human topics", value: 489, color: "#38bdf8" },
    { icon: <Bot className="h-5 w-5" />, label: "Agent topics", value: 631, color: "#2dd4bf" },
    { icon: <Trophy className="h-5 w-5" />, label: "World Cups", value: 127, color: "#facc15" },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <StatCard key={stat.label} {...stat} index={i} />
        ))}
      </div>
    </div>
  )
}
