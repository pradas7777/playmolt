"use client"

import { motion, AnimatePresence } from "motion/react"

export interface JuryVote {
  jurorName: string
  vote: "GUILTY" | "NOT_GUILTY" | null
  revealed: boolean
}

interface JuryVotePanelProps {
  active: boolean
  votes: JuryVote[]
  activeJurorIdx: number
}

export function JuryVotePanel({ active, votes, activeJurorIdx }: JuryVotePanelProps) {
  const guiltyCount = votes.filter((v) => v.revealed && v.vote === "GUILTY").length
  const notGuiltyCount = votes.filter((v) => v.revealed && v.vote === "NOT_GUILTY").length
  const totalRevealed = guiltyCount + notGuiltyCount
  const total = votes.length

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl px-5 py-4 shadow-2xl w-[300px] sm:w-[360px]"
        >
          <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400 mb-3 text-center font-bold">
            Jury Deliberation
          </p>

          {/* Juror vote indicators */}
          <div className="flex items-center justify-center gap-3 mb-4">
            {votes.map((v, i) => (
              <motion.div
                key={v.jurorName}
                animate={
                  i === activeJurorIdx && !v.revealed
                    ? { scale: [1, 1.1, 1], borderColor: ["rgba(245,158,11,0.4)", "rgba(245,158,11,0.8)", "rgba(245,158,11,0.4)"] }
                    : {}
                }
                transition={{ duration: 1.5, repeat: Infinity }}
                className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-all ${
                  v.revealed
                    ? v.vote === "GUILTY"
                      ? "border-red-500/40 bg-red-500/10"
                      : "border-sky-500/40 bg-sky-500/10"
                    : i === activeJurorIdx
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-white/10 bg-white/5"
                }`}
              >
                <span className="text-[9px] font-mono text-white/60 font-bold">{v.jurorName}</span>
                <AnimatePresence mode="wait">
                  {v.revealed ? (
                    <motion.span
                      key="vote"
                      initial={{ scale: 0, rotateY: 180 }}
                      animate={{ scale: 1, rotateY: 0 }}
                      className={`text-[10px] font-bold font-mono ${
                        v.vote === "GUILTY" ? "text-red-400" : "text-sky-400"
                      }`}
                    >
                      {v.vote === "GUILTY" ? "GUILTY" : "NOT GUILTY"}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="pending"
                      className="text-[10px] text-white/30 font-mono"
                    >
                      {i === activeJurorIdx ? "Voting..." : "---"}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>

          {/* Vote tally bars */}
          {totalRevealed > 0 && (
            <div className="flex flex-col gap-2">
              {/* Guilty bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-red-400 font-bold w-24 shrink-0">GUILTY</span>
                <div className="flex-1 h-4 rounded-full bg-white/5 overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${total > 0 ? (guiltyCount / total) * 100 : 0}%` }}
                    transition={{ duration: 0.6, type: "spring" }}
                    className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400"
                  />
                </div>
                <span className="text-sm font-mono font-bold text-white w-6 text-right">{guiltyCount}</span>
              </div>
              {/* Not guilty bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-sky-400 font-bold w-24 shrink-0">NOT GUILTY</span>
                <div className="flex-1 h-4 rounded-full bg-white/5 overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${total > 0 ? (notGuiltyCount / total) * 100 : 0}%` }}
                    transition={{ duration: 0.6, type: "spring" }}
                    className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400"
                  />
                </div>
                <span className="text-sm font-mono font-bold text-white w-6 text-right">{notGuiltyCount}</span>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
