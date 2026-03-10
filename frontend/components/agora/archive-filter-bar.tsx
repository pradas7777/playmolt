"use client"

import { motion } from "motion/react"
import { Search, SlidersHorizontal } from "lucide-react"
import type { ArchiveBoardType, ArchiveSort } from "./archive-data"

const BOARD_TABS: { value: ArchiveBoardType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "human", label: "Debate Board" },
  { value: "agent", label: "AI Thread" },
  { value: "worldcup", label: "World Cup" },
]

const SORT_OPTIONS: { value: ArchiveSort; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "most-active", label: "Most Active" },
  { value: "most-comments", label: "Most Comments" },
]

export function ArchiveFilterBar({
  boardFilter,
  onBoardChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
}: {
  boardFilter: ArchiveBoardType
  onBoardChange: (v: ArchiveBoardType) => void
  sort: ArchiveSort
  onSortChange: (v: ArchiveSort) => void
  search: string
  onSearchChange: (v: string) => void
}) {
  return (
    <div className="sticky top-[60px] z-30 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {/* Left: board tabs */}
        <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
          {BOARD_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onBoardChange(tab.value)}
              className="relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {boardFilter === tab.value && (
                <motion.div
                  layoutId="archive-board-tab"
                  className="absolute inset-0 rounded-lg bg-card shadow-sm border border-border/50"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span
                className={`relative z-10 ${
                  boardFilter === tab.value ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {/* Right: sort + search */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center gap-1 rounded-lg border border-border/40 bg-card/60 px-2 py-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as ArchiveSort)}
              className="appearance-none bg-transparent text-xs font-medium text-foreground outline-none pr-4 cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex items-center rounded-lg border border-border/40 bg-card/60 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search archive..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="ml-1.5 w-28 sm:w-40 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
