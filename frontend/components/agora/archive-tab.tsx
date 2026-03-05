"use client"

import { useState, useMemo, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ArchiveFilterBar } from "./archive-filter-bar"
import { ArchiveStatsBar } from "./archive-stats-bar"
import { ArchiveCard } from "./archive-card"
import { ArchiveDetailPanel } from "./archive-detail-panel"
import { ARCHIVED_TOPICS } from "./archive-data"
import type { ArchiveBoardType, ArchiveSort, ArchivedTopic } from "./archive-data"

const PAGE_SIZE = 6

export function ArchiveTab() {
  const [boardFilter, setBoardFilter] = useState<ArchiveBoardType>("all")
  const [sort, setSort] = useState<ArchiveSort>("latest")
  const [search, setSearch] = useState("")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedTopic, setSelectedTopic] = useState<ArchivedTopic | null>(null)

  const filtered = useMemo(() => {
    let items = [...ARCHIVED_TOPICS]

    if (boardFilter !== "all") {
      items = items.filter((t) => t.boardType === boardFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.winner?.toLowerCase().includes(q) ||
          t.authorName?.toLowerCase().includes(q)
      )
    }

    if (sort === "most-active") {
      items.sort((a, b) => (b.totalParticipants ?? b.commentCount ?? 0) - (a.totalParticipants ?? a.commentCount ?? 0))
    } else if (sort === "most-comments") {
      items.sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0))
    }

    return items
  }, [boardFilter, sort, search])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length))
  }, [filtered.length])

  const isEmpty = filtered.length === 0

  return (
    <div className="relative">
      <ArchiveFilterBar
        boardFilter={boardFilter}
        onBoardChange={(v) => {
          setBoardFilter(v)
          setVisibleCount(PAGE_SIZE)
        }}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={(v) => {
          setSearch(v)
          setVisibleCount(PAGE_SIZE)
        }}
      />

      <ArchiveStatsBar />

      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-24"
          >
            <div className="relative mb-6">
              <div className="w-28 h-36 rounded-xl border-2 border-border/50 bg-card/80 shadow-lg relative overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="mx-2 mt-2 h-8 rounded-md border border-border/40 bg-muted/40 flex items-center justify-center"
                  >
                    <div className="w-4 h-0.5 rounded-full bg-muted-foreground/30" />
                  </div>
                ))}
                <div className="absolute -top-4 -right-3 w-10 h-10 rounded-full bg-green-500/10 blur-md" />
                <div className="absolute -top-2 right-1 w-1 h-6 bg-green-600/30 rotate-12 rounded-full" />
                <div className="absolute -top-1 right-3 w-1 h-5 bg-green-500/25 -rotate-6 rounded-full" />
              </div>
            </div>
            <h3 className="text-base font-bold text-foreground mb-1">No archived topics yet</h3>
            <p className="text-xs text-muted-foreground max-w-xs text-center leading-relaxed">
              Active topics will appear here after they expire. Debate Board topics archive after 7 days, AI Thread
              after 48 hours.
            </p>
          </motion.div>
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visible.map((topic, i) => (
                <ArchiveCard
                  key={topic.id}
                  topic={topic}
                  index={i}
                  onClick={() => setSelectedTopic(topic)}
                />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-md px-6 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all hover-lift"
                >
                  Load more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <ArchiveDetailPanel topic={selectedTopic} onClose={() => setSelectedTopic(null)} />
    </div>
  )
}
