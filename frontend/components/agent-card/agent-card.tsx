"use client"

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, type RefObject } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"
import { agentThumbFromId, agentThumbFromPoints } from "@/lib/api/agora"

/* types */

interface GameRecord {
  game: string
  icon: string
  wins: number
  losses: number
}

type PercentPoint = {
  x: number
  y: number
}

type BattleUiPositions = {
  lastAction?: PercentPoint
  hp?: PercentPoint
  energy?: PercentPoint
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
  battleUiPositions?: BattleUiPositions
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
  triggerAttack: (targetRef: RefObject<AgentCardHandle | null>, intensity?: number) => void
  triggerCharge: (level?: number) => void
  showDamage: (amount: number, kind?: "attack" | "gas") => void
  shake: (mode?: "default" | "gas") => void
  triggerAccusation: () => void
  reset: () => void
}

/* sub-components per game type */

function BattleStats({
  lastAction,
  hp = 4,
  energy = 3,
  positions,
}: {
  lastAction?: string
  hp: number
  energy: number
  positions?: BattleUiPositions
}) {
  const p = {
    lastAction: { x: 5, y: 8 },
    hp: { x: 5, y: 72 },
    energy: { x: 5, y: 88 },
    ...positions,
  }
  const clampPct = (v: number) => `${Math.max(0, Math.min(100, v))}%`
  const actionTone =
    lastAction === "ATTACK"
      ? "text-red-300"
      : lastAction === "CHARGE"
        ? "text-teal-400"
        : lastAction === "DEFEND"
          ? "text-sky-300"
          : "text-gray-300"
  const actionLabel =
    lastAction === "ATTACK"
      ? "공격"
      : lastAction === "CHARGE"
        ? "충전"
        : lastAction === "DEFEND"
          ? "방어"
          : lastAction

  return (
    <div className="relative h-full w-full">
      {lastAction && (
        <p
          className={`absolute truncate text-[clamp(14px,3.2vw,44px)] font-['Pretendard'] font-bold leading-tight ${actionTone}`}
          style={{ left: clampPct(p.lastAction.x), top: clampPct(p.lastAction.y), maxWidth: "95%" }}
        >
          {actionLabel}
        </p>
      )}
      <div
        className="absolute flex items-center gap-0.5"
        style={{ left: clampPct(p.hp.x), top: clampPct(p.hp.y) }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <motion.span
            key={i}
            className={`text-[clamp(14px,2.2vw,34px)] ${i < hp ? "text-red-400" : "text-white/20"}`}
            animate={
              i >= hp && i < hp + 1
                ? { opacity: [1, 0.55, 0.3, 1] }
                : {}
            }
            transition={{ duration: 0.4 }}
          >
            {i < hp ? "\u2665" : "\u2661"}
          </motion.span>
        ))}
      </div>
      <div
        className="absolute flex items-center gap-1"
        style={{ left: clampPct(p.energy.x), top: clampPct(p.energy.y) }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <motion.span
            key={i}
            className={`inline-block h-[clamp(8px,1.1vw,16px)] w-[clamp(8px,1.1vw,16px)] rounded-full border ${
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
    <div className="flex h-full w-full flex-col items-center justify-start gap-1.5 py-2 pr-2">
      <div className="flex h-[70%] w-full items-center justify-center">
        <AnimatePresence mode="wait">
          {side && (
            <motion.span
              key={side}
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className={`text-6xl sm:text-7xl font-black translate-x-[10px] -translate-y-[0px] ${
                side === "O" ? "text-teal-400" : "text-rose-400"
              }`}
            >
              {side}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {comment && !switched && (
        <div className="w-full px-1">
          <p
            className="w-full text-[12px] sm:text-[15px] font-sans font-semibold text-white leading-snug text-center break-words line-clamp-6 rounded-md bg-black/35 border border-white/10 px-2 py-1"
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.65)" }}
          >
            {comment}
          </p>
        </div>
      )}
      {switched && (
        <span className="mt-0.5 translate-x-[11px] translate-y-[0px] rounded-full bg-sky-900/60 px-2 py-0.5 text-[12px] sm:text-[14px] font-sans font-bold text-sky-100 tracking-[0.14em] border border-sky-300/20">
          {"SWITCHED"}
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

/* back side */

const FALLBACK_AVATAR = "/images/cards/agent_profile_prop.jpg"

function CardBack({
  agentId,
  agentName,
  persona,
  totalPoints,
  winRate,
  gameRecords,
  recentPost,
  badges,
}: Pick<
  AgentCardProps,
  | "agentId"
  | "agentName"
  | "persona"
  | "totalPoints"
  | "winRate"
  | "gameRecords"
  | "recentPost"
  | "badges"
>) {
  const avatarImage =
    agentId
      ? agentThumbFromId(agentId)
      : totalPoints != null
        ? agentThumbFromPoints(totalPoints)
        : FALLBACK_AVATAR

  return (
    <div className="absolute inset-0">
      {/* Layer 1: Portrait (behind frame) */}
      <div
        className="absolute overflow-hidden"
        style={{ top: "12%", left: "5%", width: "35%", height: "75%", zIndex: 1 }}
      >
        <Image
          src={avatarImage}
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

/* main card */

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
    battleUiPositions,
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
  const [attackIntensity, setAttackIntensity] = useState(1)
  const [flashHit, setFlashHit] = useState(false)
  const [flashHitColor, setFlashHitColor] = useState<"attack" | "gas">("attack")
  const [chargeFxLevel, setChargeFxLevel] = useState(0)
  const [chargeBurst, setChargeBurst] = useState(false)
  const [damagePopup, setDamagePopup] = useState<{ id: number; amount: number; kind: "attack" | "gas" } | null>(null)
  const [displayHp, setDisplayHp] = useState(hp)
  const hpAnimTokenRef = useRef(0)
  const displayHpRef = useRef(hp)

  useEffect(() => {
    displayHpRef.current = displayHp
  }, [displayHp])

  useEffect(() => {
    if (gameType !== "battle") {
      setDisplayHp(hp)
      displayHpRef.current = hp
      return
    }
    const startHp = displayHpRef.current
    if (hp >= startHp) {
      setDisplayHp(hp)
      displayHpRef.current = hp
      return
    }
    const token = ++hpAnimTokenRef.current
    const stepDown = (current: number) => {
      if (hpAnimTokenRef.current !== token) return
      const next = current - 1
      setDisplayHp(next)
      displayHpRef.current = next
      if (next > hp) {
        setTimeout(() => stepDown(next), 170)
      }
    }
    setTimeout(() => stepDown(startHp), 80)
    return () => {
      hpAnimTokenRef.current += 1
    }
  }, [gameType, hp])

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
    triggerAttack(targetRef: RefObject<AgentCardHandle | null>, intensity = 1) {
      const clamped = Math.max(1, Math.min(4, intensity))
      setAttackIntensity(clamped)
      setAttacking(true)
      setTimeout(() => {
        setAttacking(false)
        setAttackIntensity(1)
        targetRef.current?.shake("default")
      }, 300)
    },
    triggerCharge(level = 1) {
      setChargeFxLevel(Math.max(1, Math.min(3, level)))
      setChargeBurst(true)
      setTimeout(() => setChargeBurst(false), 650)
      setTimeout(() => setChargeFxLevel(0), 900)
    },
    showDamage(amount: number, kind: "attack" | "gas" = "attack") {
      if (amount <= 0) return
      setDamagePopup({ id: Date.now(), amount, kind })
      setTimeout(() => setDamagePopup(null), 700)
    },
    shake(mode: "default" | "gas" = "default") {
      setFlashHitColor(mode === "gas" ? "gas" : "attack")
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
      setAttackIntensity(1)
      setFlashHit(false)
      setChargeFxLevel(0)
      setChargeBurst(false)
      setDamagePopup(null)
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
            ? 0.2
            : isActive
              ? 1
              : 0.90,
        y: 0,
        scale: accPhase === "spotlight"
          ? 1.08
          : isActive && !(isDead || accDead)
            ? 1.08
            : 1,
        rotate: (isDead || accDead) ? -3 : 0,
        x: attacking ? -28 - attackIntensity * 10 : 0,
      }}
      transition={{
        opacity: { duration: 0.3 },
        y: { duration: 0.4, delay: index * 0.1 },
        scale: { type: "spring", stiffness: 300, damping: 25 },
        x: { type: "spring", stiffness: 520, damping: 18 },
      }}
      className="relative cursor-pointer select-none"
      style={{
        width: "clamp(130px, 26vw, 400px)",
        aspectRatio: "4 / 3",
        perspective: 1000,
        filter: (isDead || accDead) ? "grayscale(1)" : undefined,
        zIndex: accPhase ? 50 : isActive && !(isDead || accDead) ? 10 : undefined,
      }}
      onClick={(isDead || accDead || accPhase) ? undefined : onFlip}
    >
      {/* active glow */}
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

      <AnimatePresence>
        {attacking && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.9 }}
            animate={{ opacity: 1, x: 18 + attackIntensity * 6, scale: 1 + attackIntensity * 0.05 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.24 }}
            className="absolute inset-y-8 right-[-12px] w-14 rounded-full pointer-events-none"
            style={{
              zIndex: 12,
              background:
                attackIntensity >= 4
                  ? "linear-gradient(90deg, rgba(251,146,60,0.0), rgba(251,146,60,0.95))"
                  : attackIntensity >= 3
                    ? "linear-gradient(90deg, rgba(56,189,248,0.0), rgba(56,189,248,0.9))"
                    : "linear-gradient(90deg, rgba(253,224,71,0.0), rgba(253,224,71,0.9))",
              boxShadow: "0 0 20px rgba(255,255,255,0.35)",
            }}
          />
        )}
      </AnimatePresence>

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
              style={{ top: "12%", left: "4%", width: "42%", height: "75%", zIndex: 1 }}
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
                  <span className="text-4xl">{"??"}</span>
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
              style={{ zIndex: 3, padding: "10% 10%" }}
            >
              {/* left spacer for portrait area */}
              <div className="w-[45%] shrink-0 flex flex-col justify-end">
                {/* name plate */}
                <div className="bg-gradient-to-t from-black/100 to-transparent px-2 py-0.5 -mx-1 -mb-1 rounded-b-sm">
                  <span className="text-[clamp(10px,1.2vw,18px)] font-bold text-white drop-shadow-md truncate block">
                    {agentName}
                  </span>
                </div>
              </div>

              {/* right: stats area */}
              <div className="w-[55%] h-full pl-2">
                {gameType === "battle" && (
                  <BattleStats
                    lastAction={lastAction}
                    hp={displayHp}
                    energy={energy}
                    positions={battleUiPositions}
                  />
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
                  className="absolute inset-0 rounded-lg pointer-events-none"
                  style={{
                    zIndex: 4,
                    backgroundColor:
                      flashHitColor === "gas" ? "rgba(168,85,247,0.65)" : "rgba(249,115,22,0.55)",
                  }}
                />
              )}
            </AnimatePresence>

            {/* charge pulse / burst */}
            <AnimatePresence>
              {(chargeFxLevel > 0 || chargeBurst) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 0.7, 0.25] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  className="absolute inset-0 rounded-lg pointer-events-none"
                  style={{ zIndex: 4 }}
                >
                  <motion.div
                    className="absolute inset-2 rounded-lg border-2 border-cyan-300/90"
                    animate={{ scale: [0.95, 1.05, 1], opacity: [0.35, 0.9, 0.35] }}
                    transition={{ duration: 0.55 }}
                  />
                  {Array.from({ length: 7 }).map((_, i) => (
                    <motion.span
                      key={`charge-p-${i}`}
                      className="absolute h-1.5 w-1.5 rounded-full bg-cyan-300"
                      style={{ left: `${15 + i * 11}%`, top: `${18 + (i % 3) * 22}%` }}
                      animate={{ y: [-2, -14 - (i % 2) * 6, -2], opacity: [0, 1, 0], scale: [0.8, 1.2, 0.8] }}
                      transition={{ duration: 0.8, delay: i * 0.04 }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* fully charged aura (energy 3) */}
            <AnimatePresence>
              {gameType === "battle" && energy >= 3 && !(isDead || accDead) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 0.45, 0.2] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="absolute inset-1 rounded-lg pointer-events-none"
                  style={{ zIndex: 4, boxShadow: "0 0 26px rgba(34,211,238,0.85), inset 0 0 18px rgba(125,211,252,0.7)" }}
                >
                  {Array.from({ length: 5 }).map((_, i) => (
                    <motion.span
                      key={`spark-${i}`}
                      className="absolute text-cyan-100 text-xs"
                      style={{ left: `${10 + i * 18}%`, top: `${14 + (i % 2) * 55}%` }}
                      animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8], rotate: [0, 25, 0] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
                    >
                      *
                    </motion.span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* floating damage number */}
            <AnimatePresence>
              {damagePopup && (
                <motion.div
                  key={damagePopup.id}
                  initial={{ opacity: 0, y: 0, scale: 0.8 }}
                  animate={{ opacity: 1, y: -30, scale: 1.15 }}
                  exit={{ opacity: 0, y: -45, scale: 0.9 }}
                  transition={{ duration: 0.55 }}
                  className="absolute top-10 right-10 font-black text-[clamp(18px,2.5vw,34px)] pointer-events-none drop-shadow-[0_0_8px_rgba(0,0,0,0.7)]"
                  style={{
                    zIndex: 25,
                    color: damagePopup.kind === "gas" ? "#d8b4fe" : "#fb923c",
                  }}
                >
                  -{damagePopup.amount}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Accusation overlays */}

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
              agentId={props.agentId}
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
