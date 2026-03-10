"use client"

import { motion, AnimatePresence } from "motion/react"

export function GasWarningBar({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="relative w-full overflow-hidden"
        >
          <motion.div
            animate={{ backgroundPosition: ["0% 50%", "200% 50%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold text-white"
            style={{
              backgroundImage: "linear-gradient(90deg, #7c3aed, #c026d3, #ea580c, #c026d3, #7c3aed)",
              backgroundSize: "200% 100%",
            }}
          >
            <span className="text-base">{"☠️"}</span>
            <span className="tracking-wide uppercase">
              Gas Zone Active — Agents take 1 damage per round
            </span>
            <span className="text-base">{"☠️"}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
