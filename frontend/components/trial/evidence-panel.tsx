"use client"

import { motion, AnimatePresence } from "motion/react"

interface EvidencePanelProps {
  side: "prosecution" | "defense"
  evidenceFor: string[]
  evidenceAgainst: string[]
  visible: boolean
}

export function EvidencePanel({
  side,
  evidenceFor,
  evidenceAgainst,
  visible,
}: EvidencePanelProps) {
  const isProsecution = side === "prosecution"
  const label = isProsecution ? "\uAC80\uC0AC \uCE21 \uC99D\uAC70" : "\uBCC0\uD638\uC0AC \uCE21 \uC99D\uAC70"
  const borderColor = isProsecution
    ? "border-rose-500/30"
    : "border-sky-500/30"
  const labelColor = isProsecution ? "text-rose-400" : "text-sky-400"
  const slideFrom = isProsecution ? -40 : 40

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: slideFrom }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: slideFrom }}
          transition={{ duration: 0.5, type: "spring", stiffness: 200, damping: 25 }}
          className={`rounded-xl border ${borderColor} bg-black/60 backdrop-blur-md px-4 py-3 shadow-xl w-[200px] sm:w-[240px]`}
        >
          <p className={`text-[10px] font-mono font-bold uppercase tracking-wider ${labelColor} mb-2`}>
            {label}
          </p>

          {/* Evidence for */}
          {evidenceFor.length > 0 && (
            <div className="mb-2">
              <span className="text-[9px] font-mono text-teal-400/70 uppercase tracking-wider">Support</span>
              <ul className="mt-1 flex flex-col gap-1">
                {evidenceFor.map((e, i) => (
                  <motion.li
                    key={`for-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.15 }}
                    className="text-[11px] text-teal-300 font-mono leading-relaxed flex items-start gap-1.5"
                  >
                    <span className="text-teal-500 shrink-0 mt-0.5">+</span>
                    <span>{e}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence against */}
          {evidenceAgainst.length > 0 && (
            <div>
              <span className="text-[9px] font-mono text-rose-400/70 uppercase tracking-wider">Weakness</span>
              <ul className="mt-1 flex flex-col gap-1">
                {evidenceAgainst.map((e, i) => (
                  <motion.li
                    key={`against-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (evidenceFor.length + i) * 0.15 }}
                    className="text-[11px] text-rose-300/80 font-mono leading-relaxed flex items-start gap-1.5"
                  >
                    <span className="text-rose-500 shrink-0 mt-0.5">-</span>
                    <span>{e}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
