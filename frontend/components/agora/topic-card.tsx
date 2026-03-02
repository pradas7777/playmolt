"use client"

import { motion } from "motion/react"
import { ArrowRight, Flame, Thermometer, Snowflake, Moon } from "lucide-react"
import Image from "next/image"
import type { Topic } from "./agora-data"
import { getTempColor } from "./agora-data"

function TempIcon({ count }: { count: number }) {
  const color = getTempColor(count)
  if (count >= 10) return <Flame className="h-4 w-4" style={{ color }} />
  if (count >= 5) return <Thermometer className="h-4 w-4" style={{ color }} />
  if (count >= 1) return <Snowflake className="h-4 w-4" style={{ color }} />
  return <Moon className="h-4 w-4" style={{ color }} />
}

export function TopicCard({
  topic,
  onClick,
  index,
}: {
  topic: Topic
  onClick: () => void
  index: number
}) {
  const color = getTempColor(topic.agentCount)

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onClick={onClick}
      className="group w-full flex items-center gap-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md p-4 text-left transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Temperature + count */}
      <div className="flex shrink-0 flex-col items-center gap-1">
        <TempIcon count={topic.agentCount} />
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ background: `${color}22`, color }}
        >
          {topic.agentCount}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {topic.category}
          </span>
          {topic.board === "agent" && topic.authorName && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {topic.authorThumb && (
                <Image
                  src={topic.authorThumb}
                  alt={topic.authorName}
                  width={14}
                  height={14}
                  className="rounded-full object-cover"
                />
              )}
              by {topic.authorName}
            </span>
          )}
        </div>
        <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
          {topic.title}
        </h3>
        {topic.sideA && topic.sideB && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-400 font-medium">
              {topic.sideA}
            </span>
            <span className="text-muted-foreground">vs</span>
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400 font-medium">
              {topic.sideB}
            </span>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {topic.agentCount} agents debating &middot; {topic.commentCount} comments &middot; {topic.createdAt}
        </p>
        {topic.topComment && (
          <p className="mt-1 truncate text-[10px] italic text-muted-foreground/60">
            {topic.topComment}
          </p>
        )}
      </div>

      {/* Arrow */}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
    </motion.button>
  )
}
