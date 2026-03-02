"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

interface IslandHotspotProps {
  position: { top: string; left: string }
  destination: string
  label: string
  glowColor: string
  icon: ReactNode
  description: string
  image: string
  delay: number
  tooltipPosition?: "bottom" | "top"
  /** 대기 중인 게임 수 (배지 표시, >0이면 펄스) */
  waitingCount?: number
}

export function IslandHotspot({
  position,
  destination,
  label,
  glowColor,
  icon,
  description,
  image,
  delay,
  tooltipPosition = "bottom",
  waitingCount = 0,
}: IslandHotspotProps) {
  const [hovered, setHovered] = useState(false)
  const [clicked, setClicked] = useState(false)
  const showBadge = waitingCount > 0

  return (
    <motion.div
      className="absolute z-20"
      style={{ top: position.top, left: position.left }}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 1.0 + delay * 0, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href={destination}>
        <motion.div
          className="relative flex flex-col items-center cursor-pointer"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, delay: delay * 0.5, repeat: Infinity, ease: "easeInOut" }}
          onHoverStart={() => setHovered(true)}
          onHoverEnd={() => setHovered(false)}
          onTapStart={() => setClicked(true)}
          onTap={() => {
            setClicked(false)
          }}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: [0.95, 1.05] }}
        >
          {/* Ripple ping */}
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="block h-12 w-12 sm:h-16 sm:w-16 rounded-full animate-ping opacity-20"
              style={{ backgroundColor: glowColor }}
            />
          </span>

          {/* Glow circle */}
          <motion.div
            className="relative flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full border-2 text-lg sm:text-2xl"
            style={{
              borderColor: glowColor,
              backgroundColor: `${glowColor}33`,
              boxShadow: hovered ? `0 0 30px 8px ${glowColor}66` : `0 0 12px 2px ${glowColor}33`,
            }}
            animate={hovered ? { boxShadow: `0 0 40px 12px ${glowColor}88` } : {}}
            transition={{ duration: 0.3 }}
          >
            <span>{icon}</span>
            {showBadge && (
              <span
                className={`absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${showBadge ? "animate-pulse" : ""}`}
                style={{ backgroundColor: glowColor, boxShadow: `0 0 8px ${glowColor}` }}
              >
                {waitingCount > 99 ? "99+" : waitingCount}
              </span>
            )}
          </motion.div>

          {/* Label */}
          <motion.span
            className="mt-2 rounded-full px-3 py-1 text-[10px] sm:text-xs font-bold tracking-wide text-white whitespace-nowrap"
            style={{
              backgroundColor: `${glowColor}cc`,
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}
          >
            {label}
          </motion.span>
        </motion.div>

        {/* Hover tooltip card */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: tooltipPosition === "top" ? -8 : 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: tooltipPosition === "top" ? -8 : 8, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`absolute left-1/2 -translate-x-1/2 z-50 w-[28rem] sm:w-[32rem] ${
                tooltipPosition === "top" ? "bottom-full mb-3" : "top-full mt-3"
              }`}
            >
              <div className="rounded-xl border border-white/20 bg-black/80 backdrop-blur-xl p-0 overflow-hidden shadow-2xl">
                <div className="relative h-56 sm:h-64 w-full">
                  <Image
                    src={image}
                    alt={label}
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <span className="absolute bottom-2 left-3 text-xs sm:text-sm font-bold text-white">{label}</span>
                </div>
                <div className="p-3">
                  <p className="text-[11px] sm:text-xs text-gray-300 leading-relaxed">{description}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Link>
    </motion.div>
  )
}
