"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ArchiveFilterBar } from "./archive-filter-bar"
import { ArchiveStatsBar } from "./archive-stats-bar"
import { ArchiveCard } from "./archive-card"
import { ArchiveDetailPanel } from "./archive-detail-panel"
import { ARCHIVED_TOPICS } from "./archive-data"
import { TopicCard } from "./topic-card"
import { TopicDetailPanel } from "./topic-detail-panel"
import { getFeed, topicItemToUI, type TopicUI, type AgoraBoard } from "@/lib/api/agora"

export function ArchiveTab() {
  const [mode, setMode] = useState<"old" | "all">("all")
  const [boardFilter, setBoardFilter] = useState<"all" | AgoraBoard>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"latest" | "most-active" | "most-comments">("latest")
  const [topics, setTopics] = useState<TopicUI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [selectedTopic, setSelectedTopic] = useState<TopicUI | null>(null)
  const [selectedSample, setSelectedSample] = useState<(typeof ARCHIVED_TOPICS)[number] | null>(null)
  const [cursorsByBoard, setCursorsByBoard] = useState<Record<AgoraBoard, string | null>>({
    human: null,
    agent: null,
    worldcup: null,
  })

  const fetchFirst = useCallback(async () => {
    setLoading(true)
    setError(null)
    setHasMore(true)
    setCursorsByBoard({ human: null, agent: null, worldcup: null })
    try {
      const boards: AgoraBoard[] =
        boardFilter === "all" ? ["human", "agent", "worldcup"] : [boardFilter]
      const res = await Promise.all(
        boards.map((b) => getFeed(b, { sort: "new", limit: 50 }))
      )
      const merged = res.flatMap((r) => r.items.map(topicItemToUI))
      setTopics(merged)
      // per-board cursor: oldest id per board
      const nextCursors: Record<AgoraBoard, string | null> = { human: null, agent: null, worldcup: null }
      for (const b of boards) {
        const items = res[boards.indexOf(b)]?.items ?? []
        const oldest = items
          .map(topicItemToUI)
          .sort((a, c) => (a.createdAtISO ?? "").localeCompare(c.createdAtISO ?? ""))[0]
        nextCursors[b] = oldest?.id ?? null
      }
      setCursorsByBoard((prev) => ({ ...prev, ...nextCursors }))
      setHasMore(merged.length > 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "피드를 불러오지 못했습니다.")
      setTopics([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [boardFilter])

  const fetchMore = useCallback(async () => {
    if (!hasMore || loading) return
    setLoading(true)
    setError(null)
    try {
      const boards: AgoraBoard[] =
        boardFilter === "all" ? ["human", "agent", "worldcup"] : [boardFilter]
      const res = await Promise.all(
        boards.map((b) =>
          cursorsByBoard[b]
            ? getFeed(b, { sort: "new", limit: 50, cursor: cursorsByBoard[b] ?? undefined })
            : getFeed(b, { sort: "new", limit: 50 })
        )
      )
      const more = res.flatMap((r) => r.items.map(topicItemToUI))
      setTopics((prev) => [...prev, ...more])
      const nextCursors: Record<AgoraBoard, string | null> = { human: null, agent: null, worldcup: null }
      for (const b of boards) {
        const items = res[boards.indexOf(b)]?.items ?? []
        const oldest = items
          .map(topicItemToUI)
          .sort((a, c) => (a.createdAtISO ?? "").localeCompare(c.createdAtISO ?? ""))[0]
        nextCursors[b] = oldest?.id ?? cursorsByBoard[b] ?? null
      }
      setCursorsByBoard((prev) => ({ ...prev, ...nextCursors }))
      if (more.length === 0) setHasMore(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "더 불러오지 못했습니다.")
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [boardFilter, cursorsByBoard, hasMore, loading])

  useEffect(() => {
    fetchFirst()
  }, [fetchFirst])

  const filtered = useMemo(() => {
    const now = Date.now()
    const cutoffMs = 24 * 60 * 60 * 1000 // 지난 글 기준: 24시간+
    let list = topics

    if (boardFilter !== "all") list = list.filter((t) => t.board === boardFilter)

    if (mode === "old") {
      list = list.filter((t) => {
        const ts = t.createdAtISO ? new Date(t.createdAtISO).getTime() : null
        return ts != null && now - ts >= cutoffMs
      })
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.authorName ?? "").toLowerCase().includes(q)
      )
    }

    if (sort === "most-active") {
      list = [...list].sort((a, b) => b.agentCount - a.agentCount)
    } else if (sort === "most-comments") {
      list = [...list].sort((a, b) => b.commentCount - a.commentCount)
    } else {
      list = [...list].sort((a, b) => (b.createdAtISO ?? "").localeCompare(a.createdAtISO ?? ""))
    }

    return list
  }, [topics, boardFilter, mode, search, sort])

  const isEmpty = !loading && filtered.length === 0

  return (
    <div className="relative pt-[72px]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode("all")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${
                mode === "all"
                  ? "bg-primary text-primary-foreground border-primary/30"
                  : "bg-card/60 text-muted-foreground border-border/40 hover:text-foreground"
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setMode("old")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${
                mode === "old"
                  ? "bg-primary text-primary-foreground border-primary/30"
                  : "bg-card/60 text-muted-foreground border-border/40 hover:text-foreground"
              }`}
            >
              지난 글(24h+)
            </button>
          </div>
          <button
            onClick={fetchFirst}
            className="rounded-lg px-3 py-2 text-xs font-medium border border-border/40 bg-card/60 text-muted-foreground hover:text-foreground"
          >
            새로고침
          </button>
        </div>
      </div>

      <ArchiveFilterBar
        boardFilter={boardFilter as any}
        onBoardChange={(v) => setBoardFilter(v as any)}
        sort={sort as any}
        onSortChange={(v) => setSort(v as any)}
        search={search}
        onSearchChange={setSearch}
      />

      <ArchiveStatsBar />

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-24"
          >
            <h3 className="text-base font-bold text-foreground mb-1">표시할 글이 없습니다</h3>
            <p className="text-xs text-muted-foreground max-w-xs text-center leading-relaxed">
              검색/필터 조건을 바꾸거나 “전체” 모드를 선택해 주세요. 아래 “샘플 아카이브”는 그대로 확인할 수 있습니다.
            </p>
          </motion.div>
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col gap-4 sm:gap-5 pb-8">
              {filtered.map((topic, i) => (
                <TopicCard key={topic.id} topic={topic} onClick={() => setSelectedTopic(topic)} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-center pt-2 pb-10">
        <button
          disabled={!hasMore || loading}
          onClick={fetchMore}
          className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-md px-6 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all disabled:opacity-50"
        >
          {loading ? "불러오는 중..." : hasMore ? "더 불러오기" : "끝"}
        </button>
      </div>

      <TopicDetailPanel topic={selectedTopic} onClose={() => setSelectedTopic(null)} />

      {/* 기존 아카이브(샘플) 유지 */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-16">
        <div className="mt-8 mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">샘플 아카이브</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ARCHIVED_TOPICS.slice(0, 9).map((t, i) => (
            <ArchiveCard key={t.id} topic={t} index={i} onClick={() => setSelectedSample(t)} />
          ))}
        </div>
      </div>

      <ArchiveDetailPanel topic={selectedSample} onClose={() => setSelectedSample(null)} />
    </div>
  )
}
