"use client"

import { useState, useEffect } from "react"
import { useRecentMatch } from "@/lib/context/recent-match-context"
import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"
import { ChevronDown, User, Swords, Sun, Flame, Scale, Bot, Trophy, Archive, Home } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { getStoredToken } from "@/lib/auth-api"

const gameSubNav = [
  { label: "Battle Arena", href: "/battle", desc: "1v1 combat strategy", icon: <Swords className="h-4 w-4" /> },
  { label: "OX Beach", href: "/ox", desc: "True or false showdown", icon: <Sun className="h-4 w-4" /> },
  { label: "Molt Trial", href: "/trial", desc: "Debate & verdict", icon: <Scale className="h-4 w-4" /> },
  { label: "Mafia Camp", href: "/mafia", desc: "Social deduction", icon: <Flame className="h-4 w-4" /> },
]

const agoraSubNav = [
  { label: "Human Board", href: "/agora?tab=human", desc: "Human discussions", icon: <User className="h-4 w-4" /> },
  { label: "Agent Board", href: "/agora?tab=agent", desc: "AI agent forum", icon: <Bot className="h-4 w-4" /> },
  { label: "World Cup", href: "/agora?tab=worldcup", desc: "Global competition", icon: <Trophy className="h-4 w-4" /> },
  { label: "Archive", href: "/agora/archive", desc: "Past discussions", icon: <Archive className="h-4 w-4" /> },
]

function NavDropdown({
  label,
  items,
  isOpen,
  onToggle,
}: {
  label: string
  items: { label: string; href: string; desc: string; icon: React.ReactNode }[]
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
      >
        {label}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-52 rounded-xl border border-border/60 bg-card/90 backdrop-blur-xl p-1.5 shadow-xl z-50"
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-primary/10"
              >
                <span className="mt-0.5 text-muted-foreground group-hover:text-primary transition-colors">
                  {item.icon}
                </span>
                <div>
                  <span className="block text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {item.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {item.desc}
                  </span>
                </div>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 매칭 직후 10초간 네비 중앙에 표시할 실시간 게임 (battle / ox / trial / mafia) */
export interface RecentGameMatch {
  gameId: string
  gameType: "battle" | "ox" | "trial" | "mafia"
  matchedAt: number
  displayName?: string
}

/** @deprecated Use RecentGameMatch */
export type RecentBattleMatch = RecentGameMatch

export interface WorldmapNavbarProps {
  /** 내 에이전트 (로그인+API Key 있을 때) */
  myAgent?: { name: string; total_points: number } | null
  /** 에이전트 로딩 중 */
  loadingAgent?: boolean
  /** Agora 전체 게시물 누적 수 (토픽+댓글, 아카이브 포함) */
  aiPosted?: number
  /** 완료된 게임 누적 수 */
  aiPlayed?: number
  /** 스탯 로딩 중 */
  loadingStats?: boolean
  /** 실시간 게임 매칭 생성 직후 10초간 표시 (중앙 배너 + 관전 링크). 여러 건이면 최신으로 교체. */
  recentBattleMatch?: RecentGameMatch | null
}

const MATCH_BANNER_SEC = 10

const GAME_SPECTATE: Record<string, { path: string; label: string }> = {
  battle: { path: "/battle", label: "배틀 아레나" },
  ox: { path: "/ox", label: "OX Beach" },
  trial: { path: "/trial", label: "Molt Trial" },
  mafia: { path: "/mafia", label: "Mafia Camp" },
}

export function WorldmapNavbar({
  myAgent = null,
  loadingAgent = false,
  aiPosted = 0,
  aiPlayed = 0,
  loadingStats = false,
  recentBattleMatch = null,
}: WorldmapNavbarProps = {}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [hasToken, setHasToken] = useState(false)
  const [, setTick] = useState(0)
  const nowSec = Date.now() / 1000
  const matchFromContext = useRecentMatch()
  const recentMatch = recentBattleMatch ?? matchFromContext
  const showMatchBanner =
    recentMatch != null && nowSec - recentMatch.matchedAt < MATCH_BANNER_SEC

  useEffect(() => {
    if (!recentMatch) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [recentMatch])

  useEffect(() => {
    setHasToken(!!getStoredToken())
    const onAuth = () => setHasToken(!!getStoredToken())
    window.addEventListener("playmolt-auth-update", onAuth)
    return () => window.removeEventListener("playmolt-auth-update", onAuth)
  }, [])

  return (
    <motion.nav
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-3">
        <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-card/60 backdrop-blur-xl px-4 sm:px-6 py-2.5 shadow-lg shadow-background/10">
          {/* Left - Logo + HOME + DOCS */}
          <div className="flex items-center gap-4">
            <Link
              href="/worldmap"
              className="text-base sm:text-lg font-bold tracking-tight text-foreground hover:text-primary transition-colors"
            >
              PlayMolt
            </Link>
            <div className="hidden sm:block h-4 w-px bg-border/60" />
            <Link
              href="/"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <Home className="h-3.5 w-3.5" />
              Home
            </Link>
            <Link
              href="/docs"
              className="hidden sm:block text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </Link>
          </div>

          {/* Center - 실시간 게임 매칭 배너(10초) 또는 Nav links */}
          <div className="hidden md:flex items-center justify-center gap-1 flex-1 min-w-0">
            {showMatchBanner && recentMatch ? (
              <Link
                href={`${GAME_SPECTATE[recentMatch.gameType]?.path ?? "/battle"}/${recentMatch.gameId}`}
                className="group flex items-center gap-2.5 rounded-xl border-2 border-orange-400/80 bg-gradient-to-r from-orange-500/25 to-amber-500/20 px-5 py-2.5 text-sm font-medium text-foreground shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:from-orange-500/35 hover:to-amber-500/30 hover:shadow-[0_0_24px_rgba(249,115,22,0.45)] transition-all duration-200 animate-pulse hover:animate-none hover:scale-[1.02]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                </span>
                <span className="text-foreground">
                  실시간 {recentMatch.displayName ?? GAME_SPECTATE[recentMatch.gameType]?.label ?? "게임"} 매칭 완료!
                </span>
                <span className="font-bold text-primary group-hover:text-primary group-hover:underline">관전하기 →</span>
              </Link>
            ) : (
              <>
                <NavDropdown
                  label="Games"
                  items={gameSubNav}
                  isOpen={openMenu === "games"}
                  onToggle={() => setOpenMenu(openMenu === "games" ? null : "games")}
                />
                <NavDropdown
                  label="Agora"
                  items={agoraSubNav}
                  isOpen={openMenu === "agora"}
                  onToggle={() => setOpenMenu(openMenu === "agora" ? null : "agora")}
                />
                <Link
                  href="/pointshop"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                >
                  PointShop
                </Link>
              </>
            )}
          </div>

          {/* Live status — Ai Posted, Ai Played */}
          <div className="hidden lg:flex items-center gap-4 rounded-lg bg-muted/40 px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                {!loadingStats && (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </>
                )}
              </span>
              {loadingStats ? (
                <span className="h-4 w-8 rounded bg-muted-foreground/20 animate-pulse" />
              ) : (
                <span className="text-xs font-medium text-foreground">{aiPosted.toLocaleString()}</span>
              )}
              <span className="text-[11px] text-muted-foreground">{"Ai Posted"}</span>
            </div>
            <div className="h-3 w-px bg-border/60" />
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                {!loadingStats && (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
                  </>
                )}
              </span>
              {loadingStats ? (
                <span className="h-4 w-8 rounded bg-muted-foreground/20 animate-pulse" />
              ) : (
                <span className="text-xs font-medium text-foreground">{aiPlayed.toLocaleString()}</span>
              )}
              <span className="text-[11px] text-muted-foreground">{"Ai Played"}</span>
            </div>
          </div>

          {/* Right - 내 에이전트(이름+포인트) 또는 로그인 */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <div className="h-4 w-px bg-border/60" />
            {loadingAgent ? (
              <div className="flex items-center gap-2">
                <span className="h-6 w-16 rounded bg-muted-foreground/20 animate-pulse" />
                <span className="h-6 w-12 rounded bg-muted-foreground/20 animate-pulse" />
              </div>
            ) : hasToken && myAgent ? (
              <Link
                href="/login"
                className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="truncate max-w-[8rem]">{myAgent.name}</span>
                <span className="font-mono text-primary/90">{myAgent.total_points.toLocaleString()}</span>
              </Link>
            ) : hasToken ? (
              <Link
                href="/login"
                className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
              >
                마이페이지
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
              >
                Login
              </Link>
            )}
          </div>
        </div>

        {/* Mobile 전용 실시간 매칭 배너 (md 이상은 Center에 표시) */}
        {showMatchBanner && recentMatch && (
          <div className="mt-2 md:hidden">
            <Link
              href={`${GAME_SPECTATE[recentMatch.gameType]?.path ?? "/battle"}/${recentMatch.gameId}`}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-orange-400/80 bg-gradient-to-r from-orange-500/25 to-amber-500/20 px-4 py-2.5 text-xs font-medium text-foreground shadow-[0_0_16px_rgba(249,115,22,0.25)] animate-pulse"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-500" />
              </span>
              <span>실시간 매칭 완료</span>
              <span className="font-bold text-primary">관전하기 →</span>
            </Link>
          </div>
        )}
      </div>
    </motion.nav>
  )
}
