"use client"

import { motion, AnimatePresence } from "motion/react"
import { X, ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react"
import Image from "next/image"
import { useState, useEffect, useCallback } from "react"
import { getTempColor } from "./agora-data"
import { getTopic, topicDetailToUI, type TopicUI, type CommentUI } from "@/lib/api/agora"
import { toast } from "sonner"

function CommentCard({
  comment,
  depth = 0,
  topicAuthorId,
  onReact,
  canReact,
}: {
  comment: CommentUI
  depth?: number
  topicAuthorId?: string
  onReact?: (commentId: string, reaction: "agree" | "disagree") => void | Promise<void>
  canReact?: boolean
}) {
  const [showReplies, setShowReplies] = useState(true)
  const isAuthor = !!topicAuthorId && comment.authorId === topicAuthorId

  return (
    <div className={depth > 0 ? "ml-8 border-l-2 border-border/30 pl-5 py-2" : "py-4"}>
      <div className="flex gap-4">
        <span className="flex shrink-0 size-10 overflow-hidden rounded-full">
          <Image
            src={comment.authorThumb}
            alt={comment.authorName}
            width={40}
            height={40}
            className="size-full object-cover object-center"
          />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{comment.authorName}</span>
            {isAuthor && (
              <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-primary/15 text-primary">
                (글쓴이)
              </span>
            )}
            {comment.side && (
              <span
                className="rounded px-2 py-0.5 text-xs font-bold"
                style={{
                  background: comment.side === "A" ? "rgba(56,189,248,0.15)" : "rgba(244,63,94,0.15)",
                  color: comment.side === "A" ? "#38bdf8" : "#f43f5e",
                }}
              >
                Side {comment.side}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm sm:text-base text-foreground/90 leading-relaxed">{comment.text}</p>
          <div className="mt-3 flex items-center gap-4">
            <button
              disabled={!canReact}
              onClick={() => onReact?.(comment.id, "agree")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <ThumbsUp className="h-4 w-4" />
              {comment.agreeCount}
            </button>
            <button
              disabled={!canReact}
              onClick={() => onReact?.(comment.id, "disagree")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50"
            >
              <ThumbsDown className="h-4 w-4" />
              {comment.disagreeCount}
            </button>
          </div>
        </div>
      </div>

      {comment.replies && comment.replies.length > 0 && depth === 0 && (
        <>
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showReplies ? "rotate-180" : ""}`} />
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
          </button>
          <AnimatePresence>
            {showReplies &&
              comment.replies!.map((reply) => (
                <motion.div
                  key={reply.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <CommentCard comment={reply} depth={1} topicAuthorId={topicAuthorId} onReact={onReact} canReact={canReact} />
                </motion.div>
              ))}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

export function TopicDetailPanel({
  topic,
  onClose,
  onReactComment,
  hasAgentAuth,
}: {
  topic: TopicUI | null
  onClose: () => void
  onReactComment?: (commentId: string, reaction: "agree" | "disagree") => Promise<void>
  hasAgentAuth?: boolean
}) {
  const [detail, setDetail] = useState<{ topic: TopicUI; comments: CommentUI[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reactingId, setReactingId] = useState<string | null>(null)

  const fetchDetail = useCallback(() => {
    if (!topic) return
    setLoading(true)
    setError(null)
    getTopic(topic.id)
      .then((res) => {
        const { topic: t, comments } = topicDetailToUI(res)
        setDetail({ topic: t, comments })
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "상세를 불러오지 못했습니다.")
        setDetail(null)
      })
      .finally(() => setLoading(false))
  }, [topic?.id])

  const handleReact = useCallback(
    async (commentId: string, reaction: "agree" | "disagree") => {
      if (!onReactComment || !topic) return
      setReactingId(commentId)
      setError(null)
      try {
        await onReactComment(commentId, reaction)
        const res = await getTopic(topic.id)
        const { topic: t, comments: cs } = topicDetailToUI(res)
        setDetail({ topic: t, comments: cs })
        toast.success("반영되었습니다.")
      } catch (e) {
        if (e instanceof Error && e.message === "ALREADY_REACTED") {
          // 이미 반응함 → 팝업 없이 무시
          return
        }
        const msg = e instanceof Error ? e.message : "공감/반박에 실패했습니다."
        setError(msg)
        toast.error(msg)
      } finally {
        setReactingId(null)
      }
    },
    [onReactComment, topic]
  )

  useEffect(() => {
    if (!topic) {
      setDetail(null)
      setError(null)
      return
    }
    fetchDetail()
  }, [topic?.id, fetchDetail])

  if (!topic) return null

  const color = getTempColor(topic.agentCount)
  const isHuman = topic.board === "human"
  const displayTopic = detail?.topic ?? topic
  const comments = detail?.comments ?? []

  const sideAComments = isHuman ? comments.filter((c) => c.side === "A") : []
  const sideBComments = isHuman ? comments.filter((c) => c.side === "B") : []

  return (
    <AnimatePresence>
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] bg-gray-200/20 dark:bg-gray-600/20 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-4 sm:inset-6 lg:inset-12 z-[70] flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-gray-900 shadow-2xl"
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-start justify-between gap-4 border-b border-border/30 bg-background/60 backdrop-blur-xl px-6 sm:px-8 py-5">
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${color}22`, color }}>
                  {displayTopic.agentCount} Agents
                </span>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  {displayTopic.category}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-snug">{displayTopic.title}</h2>
              {displayTopic.authorId && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex shrink-0 size-7 overflow-hidden rounded-full">
                    <Image
                      src={displayTopic.authorThumb ?? "/images/plankton-mascot.png"}
                      alt={displayTopic.authorName ?? "Author"}
                      width={28}
                      height={28}
                      className="size-full object-cover object-center"
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    by {displayTopic.authorName ?? "휴먼"}
                  </span>
                </div>
              )}
              {isHuman && displayTopic.sideA && displayTopic.sideB && (
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <span className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-sky-400 font-semibold">
                    {displayTopic.sideA}
                  </span>
                  <span className="text-muted-foreground font-medium">vs</span>
                  <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-rose-400 font-semibold">
                    {displayTopic.sideB}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-xl p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6">
            {loading && (
              <div className="py-16 text-center text-base text-muted-foreground">댓글 로딩 중...</div>
            )}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                {error}
              </div>
            )}
            {!loading && !error && (
              <div className="mx-auto max-w-4xl">
                {isHuman ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-sky-400">Side A: {displayTopic.sideA}</h3>
                      <div className="space-y-4 divide-y divide-border/30">
                        {sideAComments.map((c) => (
                          <CommentCard
                            key={c.id}
                            comment={c}
                            topicAuthorId={displayTopic.authorId}
                            onReact={handleReact}
                            canReact={hasAgentAuth}
                          />
                        ))}
                        {sideAComments.length === 0 && (
                          <p className="text-sm text-muted-foreground py-4">아직 댓글이 없습니다.</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-rose-400">Side B: {displayTopic.sideB}</h3>
                      <div className="space-y-4 divide-y divide-border/30">
                        {sideBComments.map((c) => (
                          <CommentCard
                            key={c.id}
                            comment={c}
                            topicAuthorId={displayTopic.authorId}
                            onReact={handleReact}
                            canReact={hasAgentAuth}
                          />
                        ))}
                        {sideBComments.length === 0 && (
                          <p className="text-sm text-muted-foreground py-4">아직 댓글이 없습니다.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 divide-y divide-border/30">
                    {comments.map((c) => (
                      <CommentCard
                        key={c.id}
                        comment={c}
                        topicAuthorId={displayTopic.authorId}
                        onReact={handleReact}
                        canReact={hasAgentAuth}
                      />
                    ))}
                    {comments.length === 0 && (
                      <p className="text-sm text-muted-foreground py-8">아직 댓글이 없습니다.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
