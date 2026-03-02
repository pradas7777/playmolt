"use client"

import { useState, forwardRef, useImperativeHandle, type RefObject } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

/* ─── types ─── */

interface GameRecord {
  game: string
  icon: string
  wins: number
  losses: number
}

export interface AgentCardProps {
  agentId: string
  agentName: string
  characterImage: string
  cardFramePng: string
  gameType: "battle" | "ox" | "mafia" | "trial"

  isActive: boolean
  isDead: boolean
  isFlipped: boolean
  onFlip: () => void

  // battle
  hp?: number
  energy?: number
  lastAction?: string
  // ox
  side?: "O" | "X" | null
  comment?: string
  switched?: boolean
  // mafia
  role?: string
  hint?: string
  voteTarget?: string
  roleRevealed?: boolean
  // mafia accusation
  voteCount?: number
  voters?: string[]
  // trial
  statement?: string
  verdict?: "GUILTY" | "NOT_GUILTY" | null

  // back side
  persona?: string
  totalPoints?: number
  winRate?: number
  gameRecords?: GameRecord[]
  recentPost?: string
  badges?: string[]

  // external dim control
  dimmed?: boolean

  index?: number
}

export interface AgentCardHandle {
  triggerAttack: (targetRef: RefObject<AgentCardHandle | null>) => void
  shake: () => void
  triggerAccusation: () => void
  reset: () => void
}

/* ─── sub-components per game type ─── */

function BattleStats({
  lastAction,
  hp = 4,
  energy = 3,
}: {
  lastAction?: string
  hp: number
  energy: number
}) {
  return (
    <div className="flex h-full flex-col justify-between py-2 pr-2">
      {lastAction && (
        <p className="truncate text-[10px] font-mono text-amber-200/90 leading-tight">
          {lastAction}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <motion.span
              key={i}
              className={`text-sm ${i < hp ? "text-orange-400" : "text-white/20"}`}
              animate={
                i >= hp && i < hp + 1
                  ? { scale: [1, 1.3, 0.8, 1], opacity: [1, 0.5, 0.3] }
                  : {}
              }
              transition={{ duration: 0.4 }}
            >
              {i < hp ? "\u2665" : "\u2661"}
            </motion.span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <motion.span
              key={i}
              className={`inline-block h-2.5 w-2.5 rounded-full border ${
                i < energy
                  ? "border-teal-400 bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.6)]"
                  : "border-white/20 bg-transparent"
              }`}
              animate={i < energy ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function OxStats({
  side,
  comment,
  switched,
}: {
  side?: "O" | "X" | null
  comment?: string
  switched?: boolean
}) {
  return (
    <div className="flex h-full flex-col items-center justify-between py-2 pr-2">
      {comment && (
        <p className="w-full truncate text-[10px] font-mono text-sky-200/90 leading-tight">
          {comment}
        </p>
      )}
      <AnimatePresence mode="wait">
        {side && (
          <motion.span
            key={side}
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={`text-4xl font-black ${
              side === "O" ? "text-teal-400" : "text-rose-400"
            }`}
          >
            {side}
          </motion.span>
        )}
      </AnimatePresence>
      {switched && (
        <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[9px] font-mono text-yellow-300">
          {"<-> SWITCHED"}
        </span>
      )}
    </div>
  )
}

function MafiaStats({
  role,
  hint,
  voteTarget,
  roleRevealed,
}: {
  role?: string
  hint?: string
  voteTarget?: string
  roleRevealed?: boolean
}) {
  return (
    <div className="flex h-full flex-col justify-between py-2 pr-2">
      <div className="flex justify-end">
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
            roleRevealed ? "" : "blur-[4px]"
          } ${
            role?.includes("WOLF")
              ? "bg-red-500/30 text-red-300"
              : "bg-green-500/30 text-green-300"
          }`}
        >
          {role || "???"}
        </span>
      </div>
      {hint && (
        <p className="text-center text-[10px] font-mono text-purple-200/90 leading-tight">
          {hint}
        </p>
      )}
      {voteTarget && (
        <p className="truncate text-[10px] font-mono text-white/60">
          {"Voted: " + voteTarget}
        </p>
      )}
    </div>
  )
}

function TrialStats({
  role,
  statement,
  verdict,
}: {
  role?: string
  statement?: string
  verdict?: "GUILTY" | "NOT_GUILTY" | null
}) {
  const roleColors: Record<string, string> = {
    PROSECUTOR: "bg-red-500/30 text-red-300",
    DEFENSE: "bg-blue-500/30 text-blue-300",
    JUDGE: "bg-amber-500/30 text-amber-300",
    JUROR: "bg-cyan-500/30 text-cyan-300",
  }

  return (
    <div className="flex h-full flex-col justify-between py-2 pr-2">
      {role && (
        <span
          className={`self-end rounded px-1.5 py-0.5 text-[9px] font-bold ${
            roleColors[role] || "bg-white/10 text-white/60"
          }`}
        >
          {role}
        </span>
      )}
      {statement && (
        <p className="text-center text-[10px] font-mono text-cyan-200/90 italic leading-tight line-clamp-2">
          {statement}
        </p>
      )}
      {verdict && (
        <span
          className={`self-center rounded-full px-2 py-0.5 text-[9px] font-bold ${
            verdict === "GUILTY"
              ? "bg-red-500/30 text-red-300"
              : "bg-green-500/30 text-green-300"
          }`}
        >
          {verdict === "GUILTY" ? "GUILTY" : "NOT GUILTY"}
        </span>
      )}
    </div>
  )
}

/* ─── back side ─── */

function CardBack({
  agentName,
  persona,
  totalPoints,
  winRate,
  gameRecords,
  recentPost,
  badges,
}: Pick<
  AgentCardProps,
  | "agentName"
  | "persona"
  | "totalPoints"
  | "winRate"
  | "gameRecords"
  | "recentPost"
  | "badges"
>) {
  return (
    <div className="absolute inset-0">
      {/* Layer 1: Portrait (behind frame) - common for all games */}
      <div
        className="absolute overflow-hidden"
        style={{ top: "8%", left: "5%", width: "38%", height: "84%", zIndex: 1 }}
      >
        <Image
          src="/images/cards/agent_profile_prop.jpg"
          alt={agentName}
          fill
          priority
          className="object-cover object-top"
        />
      </div>

      {/* Layer 2: Card frame PNG (on top of portrait) */}
      <Image
        src="/images/cards/agent_profile_card.png"
        alt="agent profile frame"
        fill
        className="pointer-events-none"
        style={{ zIndex: 2 }}
      />

      {/* Layer 3: Content overlay (above frame) */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{ zIndex: 3, padding: "10% 6%" }}
      >
        {/* top: name + status */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]" />
          <span className="text-[11px] font-bold text-stone-700 drop-shadow-sm truncate">{agentName}</span>
        </div>

        <div className="flex flex-1 gap-2 min-h-0">
          {/* left spacer for portrait area */}
          <div className="w-[40%] shrink-0" />

          {/* right: info */}
          <div className="flex flex-1 flex-col gap-1 overflow-hidden">
            {persona && (
              <p className="text-[8px] italic text-stone-600 leading-tight line-clamp-2 drop-shadow-sm">
                {persona}
              </p>
            )}

            {/* stats row */}
            <div className="flex gap-2 text-[8px] font-mono text-stone-700">
              {totalPoints !== undefined && <span>{totalPoints.toLocaleString()} pts</span>}
              {winRate !== undefined && <span>{winRate}% WR</span>}
            </div>

            {/* game records */}
            {gameRecords && gameRecords.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {gameRecords.map((r) => (
                  <div key={r.game} className="flex items-center gap-1 text-[7px] font-mono text-stone-600">
                    <span>{r.icon}</span>
                    <span className="truncate">{r.game}</span>
                    <span className="ml-auto text-green-700">W:{r.wins}</span>
                    <span className="text-red-600">L:{r.losses}</span>
                  </div>
                ))}
              </div>
            )}

            {/* recent post */}
            {recentPost && (
              <p className="mt-auto truncate text-[7px] text-stone-500 italic">
                {recentPost}
              </p>
            )}

            {/* badges */}
            {badges && badges.length > 0 && (
              <div className="flex gap-0.5 mt-0.5">
                {badges.slice(0, 5).map((b, i) => (
                  <span key={i} className="text-[10px]">{b}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── main card ─── */

const GLOW_COLORS: Record<string, string> = {
  battle: "rgba(249,115,22,0.5)",
  ox: "rgba(250,204,21,0.5)",
  mafia: "rgba(168,85,247,0.5)",
  trial: "rgba(34,211,238,0.5)",
}

export const AgentCard = forwardRef<AgentCardHandle, AgentCardProps>(function AgentCard(
  props,
  ref
) {
  const {
    agentName,
    characterImage,
    cardFramePng,
    gameType,
    isActive,
    isDead,
    isFlipped,
    onFlip,
    hp = 4,
    energy = 3,
    lastAction,
    side,
    comment,
    switched,
    role,
    hint,
    voteTarget,
    roleRevealed,
    voteCount,
    voters,
    statement,
    verdict,
    persona,
    totalPoints,
    winRate,
    gameRecords,
    recentPost,
    badges,
    dimmed,
    index = 0,
  } = props

  const [shaking, setShaking] = useState(false)
  const [attacking, setAttacking] = useState(false)
  const [flashHit, setFlashHit] = useState(false)

  // accusation sequence states
  const [accPhase, setAccPhase] = useState<
    null | "spotlight" | "votes" | "accusation" | "reveal" | "elimination"
  >(null)
  const [accFlipped, setAccFlipped] = useState(false)
  const [accRoleRevealed, setAccRoleRevealed] = useState(false)
  const [accDead, setAccDead] = useState(false)
  const [accRipples, setAccRipples] = useState(false)
  const [accShake, setAccShake] = useState(false)

  useImperativeHandle(ref, () => ({
    triggerAttack(targetRef: RefObject<AgentCardHandle | null>) {
      setAttacking(true)
      setTimeout(() => {
        setAttacking(false)
        targetRef.current?.shake()
      }, 300)
    },
    shake() {
      setFlashHit(true)
      setShaking(true)
      setTimeout(() => {
        setShaking(false)
        setFlashHit(false)
      }, 400)
    },
    triggerAccusation() {
      // Step 1: Spotlight (0ms)
      setAccPhase("spotlight")
      // Step 2: Vote indicators (400ms)
      setTimeout(() => setAccPhase("votes"), 400)
      // Step 3: Accusation moment (1000ms)
      setTimeout(() => {
        setAccPhase("accusation")
        setAccRipples(true)
        setAccShake(true)
        setTimeout(() => setAccShake(false), 400)
        setTimeout(() => setAccRipples(false), 800)
      }, 1000)
      // Step 4: Role reveal - flip to back (1800ms)
      setTimeout(() => {
        setAccPhase("reveal")
        setAccFlipped(true)
        setAccRoleRevealed(true)
      }, 1800)
      // Step 5: Elimination - flip back, apply dead (2400ms)
      setTimeout(() => {
        setAccPhase("elimination")
        setAccFlipped(false)
        setTimeout(() => {
          setAccDead(true)
          setTimeout(() => setAccPhase(null), 600)
        }, 300)
      }, 2400)
    },
    reset() {
      setAccPhase(null)
      setAccFlipped(false)
      setAccRoleRevealed(false)
      setAccDead(false)
      setAccRipples(false)
      setAccShake(false)
      setShaking(false)
      setAttacking(false)
      setFlashHit(false)
    },
  }))

  const glowColor = GLOW_COLORS[gameType]

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{
        opacity: dimmed
          ? 0.3
          : (isDead || accDead)
            ? 0.5
            : isActive
              ? 1
              : 0.75,
        y: 0,
        scale: accPhase === "spotlight"
          ? 1.08
          : isActive && !(isDead || accDead)
            ? 1.08
            : 1,
        rotate: (isDead || accDead) ? -3 : 0,
        x: attacking ? -40 : 0,
      }}
      transition={{
        opacity: { duration: 0.3 },
        y: { duration: 0.4, delay: index * 0.1 },
        scale: { type: "spring", stiffness: 300, damping: 25 },
        x: { type: "spring", stiffness: 500, damping: 20 },
      }}
      className="relative cursor-pointer select-none"
      style={{
        width: 400,
        height: 300,
        perspective: 1000,
        filter: (isDead || accDead) ? "grayscale(1)" : undefined,
        zIndex: accPhase ? 50 : isActive && !(isDead || accDead) ? 10 : undefined,
      }}
      onClick={(isDead || accDead || accPhase) ? undefined : onFlip}
    >
      {/* active glow — 턴 활성 강조 */}
      {isActive && !isDead && (
        <motion.div
          className="absolute -inset-2 rounded-xl z-0 pointer-events-none"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{
            boxShadow: `0 0 40px 12px ${glowColor}, 0 0 80px 24px ${glowColor}, inset 0 0 30px 8px ${glowColor}`,
            border: `3px solid ${glowColor}`,
          }}
        />
      )}

      {/* shake wrapper */}
      <motion.div
        animate={
          (shaking || accShake)
            ? { x: [0, -8, 8, -8, 8, 0] }
            : {}
        }
        transition={{ duration: 0.35 }}
        className="relative h-full w-full"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* flip container */}
        <motion.div
          animate={{ rotateY: (isFlipped || accFlipped) ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative h-full w-full"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* === FRONT === */}
          <div
            className="absolute inset-0"
            style={{ backfaceVisibility: "hidden" }}
          >
            {/* Layer 1: Portrait (bottom) */}
            <div
              className="absolute overflow-hidden"
              style={{ top: "6%", left: "4%", width: "42%", height: "88%", zIndex: 1 }}
            >
              <Image
                src={characterImage}
                alt={agentName}
                fill
                priority
                className="object-cover object-top"
              />
              {/* dead overlay */}
              {(isDead || accDead) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
                  <span className="text-4xl">{"💀"}</span>
                </div>
              )}
            </div>

            {/* Layer 2: Card frame PNG (on top of portrait) */}
            <Image
              src={cardFramePng}
              alt="card frame"
              fill
              className="pointer-events-none"
              style={{ zIndex: 2 }}
            />

            {/* Layer 3: Stats & UI overlay (above frame) */}
            <div
              className="absolute inset-0 flex"
              style={{ zIndex: 3, padding: "6% 4%" }}
            >
              {/* left spacer for portrait area */}
              <div className="w-[45%] shrink-0 flex flex-col justify-end">
                {/* name plate */}
                <div className="bg-gradient-to-t from-black/80 to-transparent px-2 py-1 -mx-1 -mb-1 rounded-b-sm">
                  <span className="text-[10px] font-bold text-white drop-shadow-md truncate block">
                    {agentName}
                  </span>
                </div>
              </div>

              {/* right: stats area */}
              <div className="w-[55%] h-full pl-2">
                {gameType === "battle" && (
                  <BattleStats lastAction={lastAction} hp={hp} energy={energy} />
                )}
                {gameType === "ox" && (
                  <OxStats side={side} comment={comment} switched={switched} />
                )}
                {gameType === "mafia" && (
                  <MafiaStats
                    role={role}
                    hint={hint}
                    voteTarget={voteTarget}
                    roleRevealed={roleRevealed || accRoleRevealed}
                  />
                )}
                {gameType === "trial" && (
                  <TrialStats role={role} statement={statement} verdict={verdict} />
                )}
              </div>
            </div>

            {/* hit flash overlay */}
            <AnimatePresence>
              {flashHit && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.4 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 rounded-lg bg-orange-500 pointer-events-none"
                  style={{ zIndex: 4 }}
                />
              )}
            </AnimatePresence>

            {/* ── Accusation overlays ── */}

            {/* Step 1: White flash */}
            <AnimatePresence>
              {accPhase === "spotlight" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.6, 0] }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 rounded-lg bg-white pointer-events-none"
                  style={{ zIndex: 10 }}
                />
              )}
            </AnimatePresence>

            {/* Step 2: Vote indicators */}
            <AnimatePresence>
              {(accPhase === "votes" || accPhase === "accusation" || accPhase === "reveal") && voters && voters.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute -top-8 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none"
                  style={{ zIndex: 20 }}
                >
                  {voters.map((voter, i) => (
                    <motion.span
                      key={voter}
                      initial={{ opacity: 0, y: -16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1, type: "spring", stiffness: 400, damping: 20 }}
                      className="rounded-full bg-rose-500/80 backdrop-blur-sm px-2 py-0.5 text-[9px] font-mono text-white shadow-lg"
                    >
                      {"ballotbox " + voter}
                    </motion.span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Step 3: Target icon + ripples */}
            <AnimatePresence>
              {accPhase === "accusation" && (
                <>
                  <motion.div
                    initial={{ scale: 0, y: -40 }}
                    animate={{ scale: [0, 1.3, 1], y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl pointer-events-none"
                    style={{ zIndex: 15 }}
                  >
                    {"target"}
                  </motion.div>
                  {accRipples && (
                    <>
                      {[0, 1, 2].map((ring) => (
                        <motion.div
                          key={ring}
                          initial={{ scale: 0.2, opacity: 0.6 }}
                          animate={{ scale: 2.5, opacity: 0 }}
                          transition={{ duration: 0.7, delay: ring * 0.15 }}
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 pointer-events-none"
                          style={{ width: 60, height: 60, zIndex: 14 }}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </AnimatePresence>

            {/* Step 4: Role reveal glow */}
            <AnimatePresence>
              {accPhase === "reveal" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.3 }}
                  exit={{ opacity: 0 }}
                  className={`absolute inset-0 rounded-lg pointer-events-none ${
                    role?.includes("WOLF") ? "bg-red-500" : "bg-blue-500"
                  }`}
                  style={{ zIndex: 10 }}
                />
              )}
            </AnimatePresence>

            {/* Vote count badge */}
            <AnimatePresence>
              {accPhase && voteCount !== undefined && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-3 -right-3 rounded-full bg-red-600 text-white text-xs font-bold w-7 h-7 flex items-center justify-center shadow-lg"
                  style={{ zIndex: 20 }}
                >
                  {voteCount}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* === BACK === */}
          <div
            className="absolute inset-0"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <CardBack
              agentName={agentName}
              persona={persona}
              totalPoints={totalPoints}
              winRate={winRate}
              gameRecords={gameRecords}
              recentPost={recentPost}
              badges={badges}
            />
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
})
