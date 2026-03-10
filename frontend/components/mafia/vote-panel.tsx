"use client"

import { motion, AnimatePresence } from "motion/react"

export interface VoteTally {
  agentName: string
  votes: number
  voters: string[]
}

interface VotePanelProps {
  active: boolean
  tallies: VoteTally[]
  totalVoters: number
}

export function VotePanel({ active, tallies, totalVoters }: VotePanelProps) {
  const sorted = [...tallies].sort((a, b) => b.votes - a.votes)
  const maxVotes = Math.max(...tallies.map((t) => t.votes), 1)

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
        >
          <div className="rounded-xl border border-white/15 bg-black/70 backdrop-blur-xl px-6 py-5 shadow-2xl w-[320px] sm:w-[400px] pointer-events-auto">
            <div className="flex items-center gap-2 mb-4">
              <motion.span
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-lg"
              >
                {"\uD83D\uDDF3\uFE0F"}
              </motion.span>
              <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
                Vote Tally
              </h3>
              <span className="ml-auto text-[10px] font-mono text-white/40">
                {tallies.reduce((s, t) => s + t.votes, 0)}/{totalVoters} votes
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {sorted.map((tally, i) => {
                const pct = (tally.votes / totalVoters) * 100
                const barPct = (tally.votes / maxVotes) * 100
                const isTop = i === 0 && tally.votes > 0

                return (
                  <motion.div
                    key={tally.agentName}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span
                        className={`text-xs font-mono font-bold ${
                          isTop ? "text-rose-300" : "text-white/70"
                        }`}
                      >
                        {tally.agentName}
                      </span>
                      <span className="text-[10px] font-mono text-white/40">
                        {tally.votes} vote{tally.votes !== 1 ? "s" : ""} ({Math.round(pct)}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${
                          isTop
                            ? "bg-gradient-to-r from-rose-500 to-red-400"
                            : "bg-white/20"
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${barPct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.1, type: "spring", stiffness: 120, damping: 20 }}
                      />
                    </div>
                    {tally.voters.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {tally.voters.map((v) => (
                          <span
                            key={v}
                            className="text-[8px] font-mono text-white/30 bg-white/5 rounded px-1"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
