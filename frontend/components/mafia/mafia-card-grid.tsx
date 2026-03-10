"use client"

import { useRef, useCallback, useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"
import { SpeechBubble } from "./speech-bubble"
import type { MafiaPhase } from "./mafia-round-info"

export interface MafiaAgent {
  id: string
  name: string
  characterImage: string
  word: string
  role: "WOLF" | "SHEEP"
  hints: string[]
  voteTarget?: string
  eliminated: boolean
  roleRevealed: boolean
  isSpeaking: boolean
}

export type VoteDetailEntry = { voter_id: string; target_id: string; reason?: string }

interface MafiaCardGridProps {
  agents: MafiaAgent[]
  phase: MafiaPhase
  observerMode: boolean
  visibleBubbles: Record<string, string>
  voteDetail?: VoteDetailEntry[]
  flippedIds: Set<string>
  onAgentFlip: (id: string) => void
  eliminatedId?: string
}

const CARD_FRAME = "/images/cards/mafia_game_card.png"

const VOTE_ARROW_INTERVAL_MS = 600

const VOTE_ARROW_COLORS = [
  "#f97316", // orange
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#eab308", // yellow
]

export function MafiaCardGrid({
  agents,
  phase,
  observerMode,
  visibleBubbles,
  voteDetail = [],
  flippedIds,
  onAgentFlip,
  eliminatedId,
}: MafiaCardGridProps) {
  const cardRefs = useRef<(AgentCardHandle | null)[]>([null, null, null, null, null, null])
  const containerRef = useRef<HTMLDivElement>(null)
  const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null, null, null])

  const [arrowLayout, setArrowLayout] = useState<{
    width: number
    height: number
    positions: Record<string, { x: number; y: number }>
  } | null>(null)
  const [visibleVoteCount, setVisibleVoteCount] = useState(0)

  const showVoteArrows = (phase === "VOTE" || phase === "REVOTE" || phase === "REVEAL") && voteDetail.length > 0

  useEffect(() => {
    if (!showVoteArrows || agents.length === 0) {
      setVisibleVoteCount(0)
      return
    }
    setVisibleVoteCount(0)
    const total = voteDetail.length
    if (total === 0) return
    const t = setInterval(() => {
      setVisibleVoteCount((n) => (n < total ? n + 1 : n))
    }, VOTE_ARROW_INTERVAL_MS)
    return () => clearInterval(t)
  }, [showVoteArrows, phase, voteDetail.length, agents.length])

  const measureArrowLayout = useCallback(() => {
    if (!containerRef.current || agents.length === 0) return
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const positions: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < agents.length && i < 6; i++) {
      const el = cardWrapperRefs.current[i]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      positions[agents[i].id] = {
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + rect.height / 2,
      }
    }
    setArrowLayout({
      width: containerRect.width,
      height: containerRect.height,
      positions,
    })
  }, [agents])

  useEffect(() => {
    if (!showVoteArrows || agents.length === 0) {
      setArrowLayout(null)
      return
    }
    measureArrowLayout()
    const t = setTimeout(measureArrowLayout, 150)
    return () => clearTimeout(t)
  }, [showVoteArrows, agents, phase, measureArrowLayout])

  const triggerAccusation = useCallback((idx: number) => {
    cardRefs.current[idx]?.triggerAccusation()
  }, [])

  const hasAgents = agents.length > 0

  // 정오각형 배치: 5개 카드, 꼭짓점에 배치 (0=상단, 시계방향), 반지름 40%
  const getPentagonPosition = (idx: number) => {
    const angle = (-90 + idx * 72) * (Math.PI / 180)
    return {
      x: 50 + 40 * Math.cos(angle),
      y: 50 + 40 * Math.sin(angle),
    }
  }

  const isHintPhase = phase === "HINT"
  const isVotePhase = phase === "VOTE" || phase === "REVOTE"

  const getGlowStyle = (agent: MafiaAgent): string => {
    if (agent.eliminated) return ""
    if (agent.isSpeaking) return "ring-2 ring-amber-400/60 shadow-[0_0_20px_4px_rgba(251,191,36,0.3)]"
    if (agent.roleRevealed && agent.role === "WOLF") return "ring-2 ring-red-500/60 shadow-[0_0_20px_4px_rgba(239,68,68,0.3)]"
    if (agent.roleRevealed && agent.role === "SHEEP") return "ring-2 ring-blue-500/60 shadow-[0_0_20px_4px_rgba(59,130,246,0.3)]"
    return ""
  }

  const renderCard = (agent: MafiaAgent, idx: number) => {
    const bubbleText = visibleBubbles[agent.id]
    const hintForCard = observerMode ? agent.word : undefined
    const roleForCard = observerMode || agent.roleRevealed
      ? (agent.role === "WOLF" ? "\uD83D\uDC3A WOLF" : "\uD83D\uDC11 SHEEP")
      : "???"
    const roleRevealed = observerMode || agent.roleRevealed
    const pos = getPentagonPosition(idx)
    const bubbleSide = idx <= 2 ? "right" : "left"

    return (
      <motion.div
        key={agent.id}
        layout
        className="relative flex flex-col items-center z-10"
        style={{
          position: "absolute",
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Card */}
        <motion.div
          ref={(el) => {
            if (el) cardWrapperRefs.current[idx] = el as HTMLDivElement
          }}
          animate={{
            scale: agent.isSpeaking ? 1.03 : 1,
            filter: agent.eliminated ? "grayscale(1)" : "none",
            opacity: agent.eliminated ? 0.5 : 1,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className={`relative rounded-lg transition-all duration-300 ${getGlowStyle(agent)}`}
        >
          <div className="transform scale-[0.55] sm:scale-[0.6] md:scale-[0.65] origin-center">
            <AgentCard
              ref={(el) => {
                cardRefs.current[idx] = el
              }}
              agentId={agent.id}
              agentName={agent.name}
              characterImage={agent.characterImage}
              cardFramePng={CARD_FRAME}
              gameType="mafia"
              isActive={agent.isSpeaking}
              isDead={agent.eliminated}
              isFlipped={flippedIds.has(agent.id)}
              onFlip={() => onAgentFlip(agent.id)}
              role={roleForCard}
              hint={hintForCard}
              roleRevealed={roleRevealed}
              voteTarget={isVotePhase ? agent.voteTarget : undefined}
              persona={`Mafia Camp agent`}
              totalPoints={1500}
              winRate={60}
              index={idx}
            />
          </div>

          {/* Eliminated overlay */}
          <AnimatePresence>
            {agent.eliminated && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 pointer-events-none z-10"
              >
                <span className="text-3xl">{"\uD83D\uDC80"}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Speech bubble - 카드 위쪽에 표시 */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-[140px] sm:w-[180px] min-h-[36px] flex justify-center">
          <AnimatePresence>
            {bubbleText && (
              <SpeechBubble
                agentName={agent.name}
                text={bubbleText}
                side={bubbleSide}
                visible={!!bubbleText}
                delay={0}
                isVote={isVotePhase}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center flex-1 min-h-[380px] px-2 sm:px-4 w-full max-w-[900px] mx-auto overflow-visible"
      style={{ aspectRatio: "1" }}
    >
      {/* Vote arrows overlay */}
      {showVoteArrows && arrowLayout && visibleVoteCount > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-[5]"
          width={arrowLayout.width}
          height={arrowLayout.height}
          style={{ left: 0, top: 0 }}
        >
          <defs>
            {VOTE_ARROW_COLORS.map((fill, idx) => (
              <marker
                key={idx}
                id={`vote-arrowhead-${idx}`}
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill={fill} />
              </marker>
            ))}
          </defs>
          {voteDetail.slice(0, visibleVoteCount).map((vote, i) => {
            const from = arrowLayout.positions[vote.voter_id]
            const to = arrowLayout.positions[vote.target_id]
            if (!from || !to) return null
            const colorIndex = agents.findIndex((a) => a.id === vote.voter_id)
            const color = VOTE_ARROW_COLORS[colorIndex >= 0 ? colorIndex % VOTE_ARROW_COLORS.length : 0]
            const markerId = `vote-arrowhead-${colorIndex >= 0 ? colorIndex % VOTE_ARROW_COLORS.length : 0}`
            const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`
            return (
              <motion.path
                key={`${vote.voter_id}-${vote.target_id}-${i}`}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                markerEnd={`url(#${markerId})`}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            )
          })}
        </svg>
      )}

      {/* 정오각형 배치 */}
      {hasAgents ? (
        agents.map((agent, i) => renderCard(agent, i))
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[140px] h-[200px] rounded-lg bg-white/10 border border-white/20 animate-pulse" />
        </div>
      )}

      {/* 중앙 캠프파이어 */}
      <motion.div
        animate={{ scale: [1, 1.05, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl sm:text-3xl pointer-events-none z-0"
      >
        {"\uD83D\uDD25"}
      </motion.div>
    </div>
  )
}
