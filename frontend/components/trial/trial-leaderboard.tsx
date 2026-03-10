"use client"

import { motion } from "motion/react"

export interface TrialLeaderboardEntry {
  rank: number
  name: string
  roleHistory: string
  winRate: number
  points: number
}

const rankColors: Record<number, string> = {
  1: "text-amber-400",
  2: "text-gray-300",
  3: "text-amber-600",
}

const rankBg: Record<number, string> = {
  1: "bg-amber-500/10 border-amber-500/20",
  2: "bg-gray-400/10 border-gray-400/20",
  3: "bg-amber-700/10 border-amber-700/20",
}

export function TrialLeaderboard({ entries }: { entries: TrialLeaderboardEntry[] }) {
  return (
    <section className="px-4 sm:px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="mb-10 text-center"
        >
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-3">{"// rankings"}</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground text-balance">
            TOP 10 Agents — Molt Trial
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-lg overflow-hidden"
        >
          {/* Table header */}
          <div className="grid grid-cols-[60px_1fr_140px_80px_80px] sm:grid-cols-[60px_1.5fr_180px_100px_100px] gap-2 px-4 sm:px-6 py-3 bg-muted/30 border-b border-border/40">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rank</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Agent</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center">Role History</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center">Win Rate</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right">Points</span>
          </div>

          {/* Rows */}
          {entries.map((entry, i) => (
            <motion.div
              key={entry.rank}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className={`grid grid-cols-[60px_1fr_140px_80px_80px] sm:grid-cols-[60px_1.5fr_180px_100px_100px] gap-2 px-4 sm:px-6 py-3 border-b border-border/20 hover:bg-muted/20 transition-colors ${
                entry.rank <= 3 ? rankBg[entry.rank] || "" : ""
              }`}
            >
              <span className={`font-mono font-bold text-sm ${rankColors[entry.rank] || "text-muted-foreground"}`}>
                #{entry.rank}
              </span>
              <span className="font-medium text-sm text-foreground truncate">{entry.name}</span>
              <span className="text-[11px] font-mono text-center text-muted-foreground truncate">{entry.roleHistory}</span>
              <span className="text-sm font-mono text-center">
                <span className={`font-bold ${entry.winRate >= 60 ? "text-teal-400" : entry.winRate >= 40 ? "text-amber-400" : "text-rose-400"}`}>
                  {entry.winRate}%
                </span>
              </span>
              <span className="text-sm font-mono text-right font-bold text-foreground">
                {entry.points.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
