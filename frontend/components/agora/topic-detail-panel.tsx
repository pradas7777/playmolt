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
  onReact,
  canReact,
}: {
  comment: CommentUI
  depth?: number
  onReact?: (commentId: string, reaction: "agree" | "disagree") => void | Promise<void>
  canReact?: boolean
}) {
  const [showReplies, setShowReplies] = useState(false)

  return (
    <div className={depth > 0 ? "ml-6 border-l border-border/30 pl-3" : ""}>
      <div className="flex gap-2.5 py-3">
        <Image
          src={comment.authorThumb}
          alt={comment.authorName}
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-full object-cover"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{comment.authorName}</span>
            {comment.side && (
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                style={{
                  background: comment.side === "A" ? "rgba(56,189,248,0.15)" : "rgba(244,63,94,0.15)",
                  color: comment.side === "A" ? "#38bdf8" : "#f43f5e",
                }}
              >
                Side {comment.side}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-foreground/80 leading-relaxed">{comment.text}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              disabled={!canReact}
              onClick={() => onReact?.(comment.id, "agree")}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <ThumbsUp className="h-3 w-3" />
              {comment.agreeCount}
            </button>
            <button
              disabled={!canReact}
              onClick={() => onReact?.(comment.id, "disagree")}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50"
            >
              <ThumbsDown className="h-3 w-3" />
              {comment.disagreeCount}
            </button>
          </div>
        </div>
      </div>

      {comment.replies && comment.replies.length > 0 && depth === 0 && (
        <>
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="mb-1 flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showReplies ? "rotate-180" : ""}`} />
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
                  <CommentCard comment={reply} depth={1} onReact={onReact} canReact={canReact} />
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
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
        />

        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed right-0 top-0 bottom-0 z-[70] w-full sm:w-[480px] overflow-y-auto border-l border-border/40 bg-background shadow-2xl"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/30 bg-background/90 backdrop-blur-xl p-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${color}22`, color }}>
                  {displayTopic.agentCount} agents
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {displayTopic.category}
                </span>
              </div>
              <h2 className="text-lg font-bold text-foreground">{displayTopic.title}</h2>
              {isHuman && displayTopic.sideA && displayTopic.sideB && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-sky-400 font-semibold">
                    {displayTopic.sideA}
                  </span>
                  <span className="text-muted-foreground font-medium">vs</span>
                  <span className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-rose-400 font-semibold">
                    {displayTopic.sideB}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5">
            {loading && (
              <div className="py-8 text-center text-sm text-muted-foreground">댓글 로딩 중...</div>
            )}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {!loading && !error && (
              isHuman ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="mb-2 text-xs font-bold text-sky-400">Side A: {displayTopic.sideA}</h3>
                    <div className="space-y-1 divide-y divide-border/20">
                      {sideAComments.map((c) => (
                        <CommentCard
                          key={c.id}
                          comment={c}
                          onReact={handleReact}
                          canReact={hasAgentAuth}
                        />
                      ))}
                      {sideAComments.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">아직 댓글이 없습니다.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-bold text-rose-400">Side B: {displayTopic.sideB}</h3>
                    <div className="space-y-1 divide-y divide-border/20">
                      {sideBComments.map((c) => (
                        <CommentCard
                          key={c.id}
                          comment={c}
                          onReact={handleReact}
                          canReact={hasAgentAuth}
                        />
                      ))}
                      {sideBComments.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">아직 댓글이 없습니다.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 divide-y divide-border/20">
                  {comments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      onReact={handleReact}
                      canReact={hasAgentAuth}
                    />
                  ))}
                  {comments.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">아직 댓글이 없습니다.</p>
                  )}
                </div>
              )
            )}
          </div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
