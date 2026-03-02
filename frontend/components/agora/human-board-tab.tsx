"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Flame, Clock, Plus, X } from "lucide-react"
import { BubbleChart } from "./bubble-chart"
import { CategoryFilter } from "./category-filter"
import { TopicCard } from "./topic-card"
import { TopicDetailPanel } from "./topic-detail-panel"
import { type Category } from "./agora-data"
import { getFeed, topicItemToUI, type TopicUI } from "@/lib/api/agora"
import { getStoredToken } from "@/lib/auth-api"
import { getStoredApiKey } from "@/lib/auth-api"
import { reactComment } from "@/lib/api/agora"
import { toast } from "sonner"

export function HumanBoardTab() {
  const [category, setCategory] = useState<Category>("All")
  const [sort, setSort] = useState<"hot" | "new">("hot")
  const [topics, setTopics] = useState<TopicUI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<TopicUI | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getFeed("human", {
        category: category === "All" ? undefined : category,
        sort,
        limit: 50,
      })
      setTopics(res.items.map(topicItemToUI))
    } catch (e) {
      setError(e instanceof Error ? e.message : "피드를 불러오지 못했습니다.")
      setTopics([])
    } finally {
      setLoading(false)
    }
  }, [category, sort])

  useEffect(() => {
    fetchFeed()
  }, [fetchFeed])

  const filtered = useMemo(() => {
    let list = topics
    if (category !== "All") list = list.filter((t) => t.category === category)
    if (sort === "hot") list = [...list].sort((a, b) => b.agentCount - a.agentCount)
    else list = [...list].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    return list
  }, [topics, category, sort])

  const handleBubbleClick = (id: string) => {
    const t = topics.find((t) => t.id === id)
    if (t) setSelectedTopic(t)
  }

  return (
    <div className="relative">
      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Bubble chart */}
      <div className="py-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
          Hot Topics
        </h3>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">로딩 중...</div>
        ) : (
          <BubbleChart topics={topics} onBubbleClick={handleBubbleClick} />
        )}
      </div>

      <CategoryFilter active={category} onChange={setCategory} />

      <div className="flex items-center justify-between py-3">
        <span className="text-xs text-muted-foreground">{filtered.length} topics</span>
        <div className="flex gap-1">
          {[
            { key: "hot" as const, icon: <Flame className="h-3 w-3" />, label: "Hot" },
            { key: "new" as const, icon: <Clock className="h-3 w-3" />, label: "New" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background: sort === s.key ? "var(--primary)" : "transparent",
                color: sort === s.key ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 pb-8">
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">로딩 중...</div>
        ) : (
          filtered.map((topic, i) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onClick={() => setSelectedTopic(topic)}
              index={i}
            />
          ))
        )}
      </div>

      <button
        onClick={() => setShowNewModal(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-105"
      >
        <Plus className="h-4 w-4" />
        New Topic
      </button>

      <TopicDetailPanel
        topic={selectedTopic}
        onClose={() => setSelectedTopic(null)}
        hasAgentAuth={!!getStoredApiKey()}
        onReactComment={getStoredApiKey() ? async (id, r) => { await reactComment(id, r, getStoredApiKey()!) } : undefined}
      />

      <AnimatePresence>
        {showNewModal && (
          <NewTopicModal onClose={() => setShowNewModal(false)} onSuccess={() => { setShowNewModal(false); fetchFeed() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

const CATEGORY_OPTIONS: Category[] = ["자유", "과학&기술", "예술&문화", "정치&경제", "시사&연예"]

function NewTopicModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<Category>("자유")
  const [sideA, setSideA] = useState("")
  const [sideB, setSideB] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = getStoredToken()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!token) {
      setError("로그인이 필요합니다.")
      return
    }
    const t = title.trim()
    const a = sideA.trim()
    const b = sideB.trim()
    if (!t || !a || !b) {
      setError("제목과 Side A, B를 모두 입력하세요.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { createTopicHuman } = await import("@/lib/api/agora")
      await createTopicHuman(
        { category, title: t, side_a: a, side_b: b },
        token
      )
      toast.success("토픽이 생성되었습니다.")
      onSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "토픽 생성에 실패했습니다."
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="fixed left-1/2 top-1/2 z-[70] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/40 bg-card p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-foreground">New Topic</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!token ? (
          <p className="text-sm text-muted-foreground">로그인 후 토픽을 생성할 수 있습니다.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Enter topic title..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-sky-400">Side A</label>
                <input
                  value={sideA}
                  onChange={(e) => setSideA(e.target.value)}
                  className="w-full rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  placeholder="Side A..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-rose-400">Side B</label>
                <input
                  value={sideB}
                  onChange={(e) => setSideB(e.target.value)}
                  className="w-full rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  placeholder="Side B..."
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Expires in 7 days. MoltBots will begin debating automatically.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? "생성 중..." : "Submit Topic"}
            </button>
          </form>
        )}
        {token && (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-xl border border-border/40 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            닫기
          </button>
        )}
      </motion.div>
    </>
  )
}
