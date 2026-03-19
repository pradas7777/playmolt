"use client"

import { motion, AnimatePresence } from "motion/react"
import { AgentCard } from "@/components/agent-card/agent-card"
import { DistributionBar } from "./distribution-bar"
import type { OXPhase } from "./round-info-panel"

export interface OXAgent {
  id: string
  name: string
  characterImage: string
  choice: "O" | "X" | null
  switchAvailable: boolean
  switched: boolean
  points: number
  persona: string
}

interface OXMainPanelProps {
  agents: OXAgent[]
  phase: OXPhase
  onAgentFlip?: (id: string) => void
  flippedIds: Set<string>
}

const CARD_FRAME = "/images/cards/ox_game_card.png"

/* Card base is 400x300. We define scaled sizes so layout knows the actual footprint. */
const SCALE_SM = 0.55
const SCALE_MD = 0.65
const SCALE_CENTER = 0.3
const CARD_W = 400
const CARD_H = 300

export function OXMainPanel({ agents, phase, onAgentFlip, flippedIds }: OXMainPanelProps) {
  const oAgents = agents.filter((a) => a.choice === "O")
  const xAgents = agents.filter((a) => a.choice === "X")
  const undecidedAgents = agents.filter((a) => a.choice === null)
  const showDistribution = phase !== "QUESTION_OPEN" && (oAgents.length > 0 || xAgents.length > 0)

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-2 sm:px-4 gap-4 relative">
      {/* Main 3-column layout */}
      <div className="flex items-stretch justify-center w-full max-w-[1200px] gap-2 sm:gap-4 flex-1 min-h-0">
        {/* O Zone */}
        <div className="flex-1 flex flex-col items-center rounded-xl border border-teal-500/20 bg-teal-500/5 backdrop-blur-sm p-2 sm:p-3 min-w-0">
          <motion.h2
            className="text-3xl sm:text-4xl font-black text-teal-400 mb-2 font-mono shrink-0"
            animate={phase === "REVEAL" && oAgents.length < xAgents.length ? { scale: [1, 1.1, 1], textShadow: ["0 0 0px transparent", "0 0 20px rgba(45,212,191,0.5)", "0 0 0px transparent"] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            O
          </motion.h2>
          <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
            <div
              className={`grid ${oAgents.length >= 4 ? "grid-cols-2 gap-x-3 gap-y-2" : "grid-cols-1 gap-y-2"} justify-items-center`}
            >
              <AnimatePresence mode="popLayout">
                {oAgents.map((agent, i) => (
                  <motion.div
                    key={agent.id}
                    layout
                    initial={{ x: 200, opacity: 0, scale: 0.8 }}
                    animate={{ x: 0, opacity: 1, scale: 1 }}
                    exit={{ x: -200, opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 200, damping: 25, delay: i * 0.25 }}
                    className="relative shrink-0"
                    style={{
                      width: CARD_W * SCALE_SM,
                      height: CARD_H * SCALE_SM,
                    }}
                  >
                    <div
                      className="absolute top-0 left-0 origin-top-left"
                      style={{
                        width: CARD_W,
                        height: CARD_H,
                        transform: `scale(${SCALE_SM})`,
                      }}
                    >
                      <AgentCard
                        agentId={agent.id}
                        agentName={agent.name}
                        characterImage={agent.characterImage}
                        cardFramePng={CARD_FRAME}
                        gameType="ox"
                        isActive={false}
                        isDead={false}
                        isFlipped={flippedIds.has(agent.id)}
                        onFlip={() => onAgentFlip?.(agent.id)}
                        side="O"
                        comment={agent.switched ? "Switched!" : undefined}
                        switched={agent.switched}
                        persona={agent.persona}
                        totalPoints={agent.points}
                        winRate={65}
                        index={i}
                      />
                    </div>
                    {phase === "SWITCH_TIME" && (
                      <div className="absolute top-6 right-3 z-50">
                        {agent.switchAvailable ? (
                          <motion.span
                            animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.1, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal-500/30 border border-teal-400/50 text-xs"
                            style={{ boxShadow: "0 0 10px 2px rgba(45,212,191,0.3)" }}
                          >
                            {"\uD83D\uDD04"}
                          </motion.span>
                        ) : (
                          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-white/10 border border-white/20 text-xs opacity-50">
                            {"\u2716\uFE0F"}
                          </span>
                        )}
                      </div>
                    )}
                    {agent.switched && (
                      <motion.div
                        initial={{ scale: 0, y: 10 }}
                        animate={{ scale: 1, y: 0 }}
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-50 rounded-full bg-yellow-500/20 border border-yellow-400/40 px-2 py-0.5"
                      >
                        <span className="text-[9px] font-mono font-bold text-yellow-300">
                          {"\u21C4 SWITCHED"}
                        </span>
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Center Divider */}
        <div className="flex flex-col items-center justify-start w-28 sm:w-40 relative shrink-0 pt-10 sm:pt-16">
          {/* Undecided agents (before choice) */}
          {undecidedAgents.length > 0 && (
            <div className="flex flex-col gap-0.5 items-center mb-2 flex-1 min-h-0 justify-center">
              {undecidedAgents.map((agent, i) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.55 }}
                  className="relative shrink-0"
                  style={{
                    width: CARD_W * SCALE_CENTER,
                    height: CARD_H * SCALE_CENTER,
                  }}
                >
                  <div
                    className="absolute top-0 left-0 origin-top-left"
                    style={{
                      width: CARD_W,
                      height: CARD_H,
                      transform: `scale(${SCALE_CENTER})`,
                    }}
                  >
                    <AgentCard
                      agentId={agent.id}
                      agentName={agent.name}
                      characterImage={agent.characterImage}
                      cardFramePng={CARD_FRAME}
                      gameType="ox"
                      isActive={false}
                      isDead={false}
                      isFlipped={false}
                      onFlip={() => {}}
                      persona={agent.persona}
                      totalPoints={agent.points}
                      winRate={65}
                      index={i}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Vertical divider line */}
          <motion.div
            className="w-px flex-1 min-h-[40px]"
            animate={
              phase === "SWITCH_TIME"
                ? {
                    backgroundColor: ["rgba(234,179,8,0.3)", "rgba(234,179,8,0.8)", "rgba(234,179,8,0.3)"],
                    boxShadow: [
                      "0 0 0px rgba(234,179,8,0)",
                      "0 0 12px 3px rgba(234,179,8,0.4)",
                      "0 0 0px rgba(234,179,8,0)",
                    ],
                  }
                : { backgroundColor: "rgba(255,255,255,0.15)" }
            }
            transition={{ duration: 1.5, repeat: Infinity }}
          />

          {/* VS text */}
          <motion.span
            className="my-2 text-xs font-mono font-bold text-white/40 shrink-0"
            animate={phase === "SWITCH_TIME" ? { color: ["rgba(234,179,8,0.6)", "rgba(234,179,8,1)", "rgba(234,179,8,0.6)"] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            VS
          </motion.span>

          <motion.div
            className="w-px flex-1 min-h-[40px]"
            animate={
              phase === "SWITCH_TIME"
                ? {
                    backgroundColor: ["rgba(234,179,8,0.3)", "rgba(234,179,8,0.8)", "rgba(234,179,8,0.3)"],
                    boxShadow: [
                      "0 0 0px rgba(234,179,8,0)",
                      "0 0 12px 3px rgba(234,179,8,0.4)",
                      "0 0 0px rgba(234,179,8,0)",
                    ],
                  }
                : { backgroundColor: "rgba(255,255,255,0.15)" }
            }
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>

        {/* X Zone */}
        <div className="flex-1 flex flex-col items-center rounded-xl border border-rose-500/20 bg-rose-500/5 backdrop-blur-sm p-2 sm:p-3 min-w-0">
          <motion.h2
            className="text-3xl sm:text-4xl font-black text-rose-400 mb-2 font-mono shrink-0"
            animate={phase === "REVEAL" && xAgents.length < oAgents.length ? { scale: [1, 1.1, 1], textShadow: ["0 0 0px transparent", "0 0 20px rgba(244,63,94,0.5)", "0 0 0px transparent"] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            X
          </motion.h2>
          <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
            <div
              className={`grid ${xAgents.length >= 4 ? "grid-cols-2 gap-x-3 gap-y-2" : "grid-cols-1 gap-y-2"} justify-items-center`}
            >
              <AnimatePresence mode="popLayout">
                {xAgents.map((agent, i) => (
                  <motion.div
                    key={agent.id}
                    layout
                    initial={{ x: -200, opacity: 0, scale: 0.8 }}
                    animate={{ x: 0, opacity: 1, scale: 1 }}
                    exit={{ x: 200, opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 200, damping: 25, delay: i * 0.25 }}
                    className="relative shrink-0"
                    style={{
                      width: CARD_W * SCALE_SM,
                      height: CARD_H * SCALE_SM,
                    }}
                  >
                    <div
                      className="absolute top-0 left-0 origin-top-left"
                      style={{
                        width: CARD_W,
                        height: CARD_H,
                        transform: `scale(${SCALE_SM})`,
                      }}
                    >
                      <AgentCard
                        agentId={agent.id}
                        agentName={agent.name}
                        characterImage={agent.characterImage}
                        cardFramePng={CARD_FRAME}
                        gameType="ox"
                        isActive={false}
                        isDead={false}
                        isFlipped={flippedIds.has(agent.id)}
                        onFlip={() => onAgentFlip?.(agent.id)}
                        side="X"
                        comment={agent.switched ? "Switched!" : undefined}
                        switched={agent.switched}
                        persona={agent.persona}
                        totalPoints={agent.points}
                        winRate={65}
                        index={i}
                      />
                    </div>
                    {phase === "SWITCH_TIME" && (
                      <div className="absolute top-6 right-3 z-50">
                        {agent.switchAvailable ? (
                          <motion.span
                            animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.1, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal-500/30 border border-teal-400/50 text-xs"
                            style={{ boxShadow: "0 0 10px 2px rgba(45,212,191,0.3)" }}
                          >
                            {"\uD83D\uDD04"}
                          </motion.span>
                        ) : (
                          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-white/10 border border-white/20 text-xs opacity-50">
                            {"\u2716\uFE0F"}
                          </span>
                        )}
                      </div>
                    )}
                    {agent.switched && (
                      <motion.div
                        initial={{ scale: 0, y: 10 }}
                        animate={{ scale: 1, y: 0 }}
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-50 rounded-full bg-yellow-500/20 border border-yellow-400/40 px-2 py-0.5"
                      >
                        <span className="text-[9px] font-mono font-bold text-yellow-300">
                          {"\u21C4 SWITCHED"}
                        </span>
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution bar */}
      <AnimatePresence>
        {showDistribution && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="w-full max-w-lg shrink-0"
          >
            <DistributionBar
              oCount={oAgents.length}
              xCount={xAgents.length}
              total={agents.length}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
