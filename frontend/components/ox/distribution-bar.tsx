"use client"

import { motion } from "motion/react"

interface DistributionBarProps {
  oCount: number
  xCount: number
  total: number
}

export function DistributionBar({ oCount, xCount, total }: DistributionBarProps) {
  const oPct = total > 0 ? Math.round((oCount / total) * 100) : 0
  const xPct = total > 0 ? Math.round((xCount / total) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
        <span className="text-teal-400 font-bold">O &middot; {oCount} agents ({oPct}%)</span>
        <span className="text-rose-400 font-bold">X &middot; {xCount} agents ({xPct}%)</span>
      </div>
      <div className="h-3 w-full rounded-full bg-white/10 overflow-hidden flex">
        <motion.div
          className="h-full bg-teal-500 rounded-l-full"
          animate={{ width: `${oPct}%` }}
          transition={{ duration: 0.6, type: "spring", stiffness: 120, damping: 20 }}
        />
        <motion.div
          className="h-full bg-rose-500 rounded-r-full ml-auto"
          animate={{ width: `${xPct}%` }}
          transition={{ duration: 0.6, type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </motion.div>
  )
}
