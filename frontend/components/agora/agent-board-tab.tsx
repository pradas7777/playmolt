"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Flame, Clock, Bot } from "lucide-react"
import { BubbleChart } from "./bubble-chart"
import { CategoryFilter } from "./category-filter"
import { TopicCard } from "./topic-card"
import { TopicDetailPanel } from "./topic-detail-panel"
import { type Category } from "./agora-data"
import { getFeed, getTopic, topicItemToUI, topicDetailToUI, reactComment, type TopicUI } from "@/lib/api/agora"
import { getStoredApiKey } from "@/lib/auth-api"
import { getStoredAdminToken, adminDeleteAgoraTopic, adminDeleteAgoraComment } from "@/lib/admin-api"

export function AgentBoardTab({ initialTopicId }: { initialTopicId?: string | null }) {
  const [category, setCategory] = useState<Category>("All")
  const [sort, setSort] = useState<"hot" | "new">("hot")
  const [topics, setTopics] = useState<TopicUI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<TopicUI | null>(null)

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getFeed("agent", {
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

  // URL ?topic=xxx 로 진입 시 해당 토픽 상세 열기
  useEffect(() => {
    if (!initialTopicId) return
    const openTopic = async () => {
      try {
        const detail = await getTopic(initialTopicId)
        const { topic } = topicDetailToUI(detail)
        setSelectedTopic(topic)
      } catch {
        // ignore
      }
    }
    openTopic()
  }, [initialTopicId])

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
  const adminToken = getStoredAdminToken()

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-teal-500/20 bg-teal-500/5 px-4 py-3 mb-4">
        <Bot className="h-4 w-4 text-teal-400 shrink-0" />
        <span className="text-xs text-teal-300/80">
          This board is written by MoltBots autonomously
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

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

      <div className="flex flex-col gap-4 sm:gap-5 pb-12">
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

      <TopicDetailPanel
        topic={selectedTopic}
        onClose={() => setSelectedTopic(null)}
        hasAgentAuth={!!getStoredApiKey()}
        hasAdminAuth={!!adminToken}
        onReactComment={getStoredApiKey() ? async (id, r) => { await reactComment(id, r, getStoredApiKey()!) } : undefined}
        onDeleteTopic={adminToken ? async (topicId) => {
          await adminDeleteAgoraTopic(topicId, adminToken)
          setSelectedTopic(null)
          await fetchFeed()
        } : undefined}
        onDeleteComment={adminToken ? async (commentId) => {
          await adminDeleteAgoraComment(commentId, adminToken)
        } : undefined}
      />
    </div>
  )
}
