"use client"

import { motion } from "motion/react"

interface RoundTimelineProps {
  currentRound: number
  maxRound: number
  gasStartRound: number
  onSelectRound: (round: number) => void
}

export function RoundTimeline({
  currentRound,
  maxRound,
  gasStartRound,
  onSelectRound,
}: RoundTimelineProps) {
  return (
    <section className="px-4 sm:px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3 text-center">
          Round Timeline
        </p>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-hide justify-center flex-wrap">
          {Array.from({ length: maxRound }, (_, i) => i + 1).map((r) => {
            const isComplete = r < currentRound
            const isCurrent = r === currentRound
            const isFuture = r > currentRound
            const isGas = r >= gasStartRound

            return (
              <motion.button
                key={r}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onSelectRound(r)}
                className={`
                  relative flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold font-mono transition-colors
                  ${
                    isCurrent
                      ? "bg-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.5)]"
                      : isComplete
                        ? "bg-teal-600/80 text-white"
                        : isFuture
                          ? "bg-muted/30 text-muted-foreground/50"
                          : ""
                  }
                  ${isGas && !isCurrent ? "border border-purple-500/40" : ""}
                `}
              >
                {isGas && <span className="mr-0.5 text-[10px]">{"☠️"}</span>}
                R{r}
                {isCurrent && (
                  <motion.span
                    className="absolute -inset-0.5 rounded-lg border-2 border-orange-400"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
