"use client"

import { motion } from "motion/react"
import { CATEGORIES, type Category } from "./agora-data"

export function CategoryFilter({
  active,
  onChange,
}: {
  active: Category
  onChange: (c: Category) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide py-3">
      {CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          className="relative shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
          style={{
            color: active === cat ? "var(--primary-foreground)" : "var(--muted-foreground)",
            background: active === cat ? "var(--primary)" : "transparent",
            border: active === cat ? "none" : "1px solid var(--border)",
          }}
        >
          {active === cat && (
            <motion.span
              layoutId="category-pill"
              className="absolute inset-0 rounded-full bg-primary"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              style={{ zIndex: -1 }}
            />
          )}
          {cat}
        </button>
      ))}
    </div>
  )
}
