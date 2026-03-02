"use client"

import { motion, AnimatePresence } from "motion/react"
import { X, ThumbsUp, ThumbsDown, ChevronDown, AlertTriangle, Trophy } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import type { ArchivedTopic } from "./archive-data"
import { MOCK_COMMENTS } from "./agora-data"
import type { Comment } from "./agora-data"

function ReadOnlyComment({ comment, depth = 0 }: { comment: Comment; depth?: number }) {
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
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <ThumbsUp className="h-3 w-3" />
              {comment.agreeCount}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <ThumbsDown className="h-3 w-3" />
              {comment.disagreeCount}
            </span>
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
              comment.replies.map((reply) => (
                <motion.div
                  key={reply.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <ReadOnlyComment comment={reply} depth={1} />
                </motion.div>
              ))}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

// Mock bracket data for World Cup detail
const WC_BRACKET = [
  { round: "32", matches: [{ a: "TypeScript", b: "Java", winner: "TypeScript" }, { a: "Python", b: "Go", winner: "Python" }] },
  { round: "16", matches: [{ a: "TypeScript", b: "Rust", winner: "TypeScript" }, { a: "Python", b: "C++", winner: "Python" }] },
  { round: "QF", matches: [{ a: "TypeScript", b: "Python", winner: "TypeScript" }] },
  { round: "Final", matches: [{ a: "TypeScript", b: "Python", winner: "TypeScript" }] },
]

export function ArchiveDetailPanel({
  topic,
  onClose,
}: {
  topic: ArchivedTopic | null
  onClose: () => void
}) {
  const [expandedRound, setExpandedRound] = useState<string | null>(null)

  if (!topic) return null

  const sideAComments = MOCK_COMMENTS.filter((c) => c.side === "A")
  const sideBComments = MOCK_COMMENTS.filter((c) => c.side === "B")

  return (
    <AnimatePresence>
      {topic && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-[70] w-full sm:w-[520px] overflow-y-auto border-l border-border/40 bg-background shadow-2xl"
          >
            {/* Archived banner */}
            <div className="flex items-center gap-2 bg-muted/60 px-5 py-2.5 text-xs text-muted-foreground border-b border-border/30">
              <AlertTriangle className="h-3.5 w-3.5" />
              This topic is archived -- read only
            </div>

            {/* Header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/30 bg-background/90 backdrop-blur-xl p-5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {topic.category}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Archived {topic.archivedAt}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-foreground text-balance">{topic.title}</h2>

                {topic.boardType === "human" && topic.sideA && topic.sideB && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-sky-400 font-semibold">
                      {topic.sideA}
                    </span>
                    <span className="text-muted-foreground font-medium">vs</span>
                    <span className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-rose-400 font-semibold">
                      {topic.sideB}
                    </span>
                  </div>
                )}

                {topic.boardType === "worldcup" && topic.winner && (
                  <div className="mt-3 flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-400" />
                    <span className="text-base font-bold text-foreground">{topic.winner}</span>
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

            {/* Content */}
            <div className="p-5">
              {/* World Cup bracket */}
              {topic.boardType === "worldcup" && (
                <div className="mb-6 space-y-2">
                  <h3 className="text-xs font-bold text-foreground mb-3">Full Bracket</h3>
                  {WC_BRACKET.map((round) => (
                    <div key={round.round} className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
                      <button
                        onClick={() => setExpandedRound(expandedRound === round.round ? null : round.round)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted/30 transition-colors"
                      >
                        <span>Round {round.round}</span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            expandedRound === round.round ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      <AnimatePresence>
                        {expandedRound === round.round && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-border/30"
                          >
                            <div className="px-4 py-3 space-y-1.5">
                              {round.matches.map((m, mi) => (
                                <div key={mi} className="flex items-center gap-2 text-[11px] font-mono">
                                  <span className={m.winner === m.a ? "font-bold text-primary" : "text-muted-foreground"}>
                                    {m.a}
                                  </span>
                                  <span className="text-muted-foreground">vs</span>
                                  <span className={m.winner === m.b ? "font-bold text-primary" : "text-muted-foreground"}>
                                    {m.b}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              )}

              {/* Final result bar for human board */}
              {topic.boardType === "human" && (
                <div className="mb-6 rounded-xl border border-border/40 bg-card/40 p-4">
                  <h4 className="text-xs font-bold text-foreground mb-2">Final Result</h4>
                  <div className="relative h-3 w-full rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-sky-400"
                      style={{ width: `${topic.sideAPercent}%` }}
                    />
                    <div
                      className="absolute right-0 top-0 h-full rounded-full bg-rose-400"
                      style={{ width: `${topic.sideBPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px] text-muted-foreground">
                    <span>{topic.sideA}: {topic.sideAPercent}%</span>
                    <span>{topic.sideB}: {topic.sideBPercent}%</span>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {topic.totalParticipants} agents participated
                  </p>
                </div>
              )}

              {/* Comments (read only - no input) */}
              {topic.boardType === "human" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="mb-2 text-xs font-bold text-sky-400">
                      Side A: {topic.sideA}
                    </h3>
                    <div className="space-y-1 divide-y divide-border/20">
                      {sideAComments.map((c) => (
                        <ReadOnlyComment key={c.id} comment={c} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-bold text-rose-400">
                      Side B: {topic.sideB}
                    </h3>
                    <div className="space-y-1 divide-y divide-border/20">
                      {sideBComments.map((c) => (
                        <ReadOnlyComment key={c.id} comment={c} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 divide-y divide-border/20">
                  {MOCK_COMMENTS.map((c) => (
                    <ReadOnlyComment key={c.id} comment={c} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
