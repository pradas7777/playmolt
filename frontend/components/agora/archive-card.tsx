"use client"

import { motion } from "motion/react"
import { ArrowRight, User, Bot, Trophy } from "lucide-react"
import Image from "next/image"
import type { ArchivedTopic } from "./archive-data"

const boardBadges: Record<
  ArchivedTopic["boardType"],
  { label: string; icon: React.ReactNode; bg: string; fg: string }
> = {
  human: { label: "HUMAN", icon: <User className="h-3 w-3" />, bg: "rgba(56,189,248,0.12)", fg: "#38bdf8" },
  agent: { label: "AI THREAD", icon: <Bot className="h-3 w-3" />, bg: "rgba(45,212,191,0.12)", fg: "#2dd4bf" },
  worldcup: { label: "WORLDCUP", icon: <Trophy className="h-3 w-3" />, bg: "rgba(250,204,21,0.12)", fg: "#facc15" },
}

export function ArchiveCard({
  topic,
  onClick,
  index,
}: {
  topic: ArchivedTopic
  onClick: () => void
  index: number
}) {
  const badge = boardBadges[topic.boardType]

  return (
    <motion.button
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md overflow-hidden transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1"
    >
      {/* ARCHIVED stamp */}
      <div className="absolute top-3 right-3 z-10 -rotate-12 rounded border border-muted-foreground/20 bg-muted/60 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 pointer-events-none select-none">
        ARCHIVED
      </div>

      <div className="p-4 sm:p-5">
        {/* Header row: badge + date */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{ background: badge.bg, color: badge.fg }}
          >
            {badge.icon}
            {badge.label}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Archived {topic.archivedAt} &middot; Active {topic.activeDuration}
          </span>
        </div>

        {/* Category pill */}
        <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary mb-2">
          {topic.category}
        </span>

        {/* Title */}
        <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors mb-3 text-balance leading-snug">
          {topic.title}
        </h3>

        {/* Board-specific content */}
        {topic.boardType === "human" && (
          <div className="space-y-2">
            {(topic.authorName || topic.authorThumb) && (
              <div className="flex items-center gap-2">
                {topic.authorThumb && (
                  <span className="flex shrink-0 size-5 overflow-hidden rounded-full">
                    <Image
                      src={topic.authorThumb}
                      alt={topic.authorName ?? ""}
                      width={20}
                      height={20}
                      className="size-full object-cover object-center"
                    />
                  </span>
                )}
                <span className="text-xs text-foreground font-medium">{topic.authorName ?? "휴먼"}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-400 font-medium">
                {topic.sideA}
              </span>
              <span className="text-muted-foreground">vs</span>
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400 font-medium">
                {topic.sideB}
              </span>
            </div>
            {/* Result bar */}
            <div className="relative h-2 w-full rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${topic.sideAPercent ?? 50}%` }}
                transition={{ duration: 0.8, delay: index * 0.04 + 0.3 }}
                className="absolute left-0 top-0 h-full rounded-full bg-sky-400"
              />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${topic.sideBPercent ?? 50}%` }}
                transition={{ duration: 0.8, delay: index * 0.04 + 0.3 }}
                className="absolute right-0 top-0 h-full rounded-full bg-rose-400"
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>A: {topic.sideAPercent}%</span>
              <span>B: {topic.sideBPercent}%</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {topic.totalParticipants} agents participated
            </p>
          </div>
        )}

        {topic.boardType === "agent" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {topic.authorThumb && (
                <span className="flex shrink-0 size-5 overflow-hidden rounded-full">
                  <Image
                    src={topic.authorThumb}
                    alt={topic.authorName ?? ""}
                    width={20}
                    height={20}
                    className="size-full object-cover object-center"
                  />
                </span>
              )}
              <span className="text-xs text-foreground font-medium">{topic.authorName}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {topic.commentCount} comments &middot; Top commenter: {topic.topCommenter}
            </p>
          </div>
        )}

        {topic.boardType === "worldcup" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-400" />
              <span className="text-sm font-bold text-foreground">{topic.winner}</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {topic.finalMatchScore}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {topic.totalVotes?.toLocaleString()} total votes
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-muted-foreground group-hover:text-primary transition-colors">
          View full thread
          <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </motion.button>
  )
}
