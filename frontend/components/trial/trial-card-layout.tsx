"use client"

import { useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"
import { VolatileSpeechBubble } from "./volatile-speech-bubble"
import type { TrialPhase } from "./case-info-panel"
import type { SpeakerRole } from "./center-statement-panel"

export interface TrialAgent {
  id: string
  name: string
  characterImage: string
  role: "JUDGE" | "PROSECUTOR" | "DEFENSE" | "JUROR_1" | "JUROR_2" | "JUROR_3"
  statement: string
  evidenceFor: string[]
  evidenceAgainst: string[]
  isSpeaking: boolean
  vote?: "GUILTY" | "NOT_GUILTY" | null
  voteRevealed?: boolean
}

interface TrialCardLayoutProps {
  agents: TrialAgent[]
  phase: TrialPhase
  currentSpeaker: SpeakerRole
  visibleBubble: { agentId: string; text: string } | null
  /** 라운드 내 모든 말풍선 (순차 재생 후 고정 표시용) */
  fixedBubbles?: Record<string, string>
  flippedIds: Set<string>
  onAgentFlip: (id: string) => void
}

const CARD_FRAME = "/images/cards/trial_game_card.png"

const roleBadgeText: Record<string, string> = {
  JUDGE: "⚖️ 판사",
  PROSECUTOR: "⚔️ 검사",
  DEFENSE: "🛡️ 변호사",
  JUROR_1: "배심원1",
  JUROR_2: "배심원2",
  JUROR_3: "배심원3",
}

const roleGlowColor: Record<string, string> = {
  JUDGE: "",
  PROSECUTOR: "",
  DEFENSE: "",
  JUROR_1: "",
  JUROR_2: "",
  JUROR_3: "",
}

const roleBadgeColor: Record<string, string> = {
  JUDGE: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  PROSECUTOR: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  DEFENSE: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  JUROR_1: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  JUROR_2: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  JUROR_3: "bg-amber-500/20 text-amber-300 border-amber-500/40",
}

export function TrialCardLayout({
  agents,
  phase,
  currentSpeaker,
  visibleBubble,
  fixedBubbles = {},
  flippedIds,
  onAgentFlip,
}: TrialCardLayoutProps) {
  const cardRefs = useRef<(AgentCardHandle | null)[]>([null, null, null, null, null, null])

  const judge = agents.find((a) => a.role === "JUDGE")
  const prosecutor = agents.find((a) => a.role === "PROSECUTOR")
  const defense = agents.find((a) => a.role === "DEFENSE")
  const jurors = agents.filter((a) => a.role.startsWith("JUROR"))

  const isVotePhase = phase === "JURY_FINAL" || phase === "VERDICT"

  const renderCard = (
    agent: TrialAgent,
    idx: number,
    scale: string = "scale-[0.52] sm:scale-[0.58]"
  ) => {
    const isSpeaking = agent.isSpeaking

    return (
      <motion.div
        animate={{
          scale: isSpeaking ? 1.03 : 1,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative rounded-lg transition-all duration-300"
      >
        {/* Role badge above card */}
        <div className="flex justify-center mb-2">
          <span
            className={`inline-block rounded-full border px-3 py-1 text-[11px] sm:text-[12px] font-bold font-mono ${roleBadgeColor[agent.role]}`}
          >
            {roleBadgeText[agent.role]}
          </span>
        </div>

        <div className={`transform ${scale} origin-top`}>
          <AgentCard
            ref={(el) => {
              cardRefs.current[idx] = el
            }}
            agentId={agent.id}
            agentName={agent.name}
            characterImage={agent.characterImage}
            cardFramePng={CARD_FRAME}
            gameType="trial"
            isActive={isSpeaking}
            isDead={false}
            isFlipped={flippedIds.has(agent.id)}
            onFlip={() => onAgentFlip(agent.id)}
            persona="Molt Trial participant"
            totalPoints={1800}
            winRate={65}
            index={idx}
          />
        </div>

        {/* Jury vote badge */}
        <AnimatePresence>
          {isVotePhase && agent.voteRevealed && agent.vote && (
            <motion.div
              initial={{ scale: 0, rotateY: 180 }}
              animate={{ scale: 1, rotateY: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className={`absolute top-8 left-1/2 -translate-x-1/2 z-50 rounded-lg border-2 px-3 py-1.5 font-mono font-bold text-sm shadow-lg ${
                agent.vote === "GUILTY"
                  ? "bg-red-600/90 border-red-400 text-white"
                  : "bg-sky-600/90 border-sky-400 text-white"
              }`}
            >
              {agent.vote === "GUILTY" ? "GUILTY" : "NOT GUILTY"}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative px-2 sm:px-4">
      {/* Top row: Prosecutor (left) — Judge (center) — Defense (right) */}
      <div className="flex items-start justify-center gap-3 sm:gap-6 w-full max-w-[900px] mb-4">
        {/* Prosecutor with speech bubble */}
        <div className="flex flex-col items-center gap-1 relative">
          {prosecutor && renderCard(prosecutor, judge ? 1 : 0)}
          <div className="absolute top-4 -right-[170px] sm:-right-[210px] z-40">
            {prosecutor && (fixedBubbles[prosecutor.id] ?? (visibleBubble?.agentId === prosecutor.id ? visibleBubble.text : null)) && (
              <VolatileSpeechBubble
                agentName={prosecutor.name}
                text={fixedBubbles[prosecutor.id] ?? visibleBubble!.text}
                role="PROSECUTOR"
                position="right"
                visible
              />
            )}
          </div>
        </div>

        {/* Judge (중앙) — 판사 카드 */}
        {judge && (
          <div className="flex flex-col items-center gap-1 relative">
            {renderCard(judge, 0, "scale-[0.48] sm:scale-[0.54]")}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 -translate-y-full z-40">
              {(fixedBubbles[judge.id] ?? (visibleBubble?.agentId === judge.id ? visibleBubble.text : null)) && (
                <VolatileSpeechBubble
                  agentName={judge.name}
                  text={fixedBubbles[judge.id] ?? visibleBubble!.text}
                  role="JUDGE"
                  position="top"
                  visible
                />
              )}
            </div>
          </div>
        )}

        {/* Defense with speech bubble */}
        <div className="flex flex-col items-center gap-1 relative">
          {defense && renderCard(defense, judge ? 2 : 1)}
          <div className="absolute top-4 -left-[170px] sm:-left-[210px] z-40">
            {defense && (fixedBubbles[defense.id] ?? (visibleBubble?.agentId === defense.id ? visibleBubble.text : null)) && (
              <VolatileSpeechBubble
                agentName={defense.name}
                text={fixedBubbles[defense.id] ?? visibleBubble!.text}
                role="DEFENSE"
                position="left"
                visible
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: 3 Jurors centered */}
      <div className="flex items-start justify-center gap-3 sm:gap-6">
        {jurors.map((juror, i) => (
          <div key={juror.id} className="flex flex-col items-center gap-1 relative">
            {renderCard(juror, i + (judge ? 3 : 2), "scale-[0.5] sm:scale-[0.56]")}
            {/* Bubble floats above */}
            <div className="absolute -top-[120px] left-1/2 -translate-x-1/2 z-40">
              {(fixedBubbles[juror.id] ?? (visibleBubble?.agentId === juror.id ? visibleBubble.text : null)) && (
                <VolatileSpeechBubble
                  agentName={juror.name}
                  text={fixedBubbles[juror.id] ?? visibleBubble!.text}
                  role="JUROR"
                  position="top"
                  visible
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
