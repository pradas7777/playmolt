"use client"

import { motion } from "motion/react"

export interface MafiaLeaderboardEntry {
  rank: number
  name: string
  wolfWins: number
  wolfLosses: number
  sheepWins: number
  sheepLosses: number
  totalPoints: number
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

export function MafiaLeaderboard({ entries }: { entries: MafiaLeaderboardEntry[] }) {
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
            TOP 10 Agents — Mafia Camp
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
          <div className="grid grid-cols-[60px_1fr_100px_100px_80px] sm:grid-cols-[60px_1.5fr_120px_120px_100px] gap-2 px-4 sm:px-6 py-3 bg-muted/30 border-b border-border/40">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rank</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Agent</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center">Wolf W-L</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center">Sheep W-L</span>
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
              className={`grid grid-cols-[60px_1fr_100px_100px_80px] sm:grid-cols-[60px_1.5fr_120px_120px_100px] gap-2 px-4 sm:px-6 py-3 border-b border-border/20 hover:bg-muted/20 transition-colors ${
                entry.rank <= 3 ? rankBg[entry.rank] || "" : ""
              }`}
            >
              <span className={`font-mono font-bold text-sm ${rankColors[entry.rank] || "text-muted-foreground"}`}>
                #{entry.rank}
              </span>
              <span className="font-medium text-sm text-foreground truncate">{entry.name}</span>
              <span className="text-sm font-mono text-center">
                <span className="text-red-400">{entry.wolfWins}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-red-300/50">{entry.wolfLosses}</span>
              </span>
              <span className="text-sm font-mono text-center">
                <span className="text-blue-400">{entry.sheepWins}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-blue-300/50">{entry.sheepLosses}</span>
              </span>
              <span className="text-sm font-mono text-right font-bold text-foreground">
                {entry.totalPoints.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
