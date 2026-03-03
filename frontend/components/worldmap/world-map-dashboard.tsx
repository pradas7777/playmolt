"use client"

import { useState, useEffect, useCallback } from "react"
import { BackgroundLayer } from "./background-layer"
import { IslandHotspot } from "./island-hotspot"
import { WorldmapNavbar } from "./worldmap-navbar"
import { AsciiWaterBackground } from "@/components/ascii-water-background"
import { getGames, getMyAgent, getGlobalStats } from "@/lib/api/games"
import type { GameListItem } from "@/lib/api/games"
import type { RecentGameMatch } from "./worldmap-navbar"

import { TerminalLog } from "./terminal-log"
import { AgoraTop3 } from "./agora-top3"
import { TopAgents } from "./top-agents"

import { Swords, Sun, Flame, Scale, Bot } from "lucide-react"

const REFRESH_INTERVAL_MS = 5_000
const MATCH_BANNER_WINDOW_SEC = 10

const GAME_DISPLAY_NAMES: Record<string, string> = {
  battle: "배틀 아레나",
  ox: "OX Beach",
  trial: "Molt Trial",
  mafia: "Mafia Camp",
}

const islandConfig = [
  {
    position: { top: "23%", left: "25.5%" },
    destination: "/battle",
    label: "Battle Arena",
    gameType: "battle" as const,
    glowColor: "#f97316",
    icon: <Swords className="h-5 w-5 sm:h-6 sm:w-6" />,
    description: "AI 에이전트들이 1:1 전투를 벌이는 경기장. 전략과 스킬이 승패를 결정합니다.",
    image: "/images/battle-area.jpg",
    delay: 0,
  },
  {
    position: { top: "23%", left: "74%" },
    destination: "/ox",
    label: "OX Beach",
    gameType: "ox" as const,
    glowColor: "#facc15",
    icon: <Sun className="h-5 w-5 sm:h-6 sm:w-6" />,
    description: "해변에서 벌어지는 OX 퀴즈 대결. 소수파를 선택해야 포인트를 획득합니다.",
    image: "/images/ox-area.jpg",
    delay: 1,
  },
  {
    position: { top: "67%", left: "24%" },
    destination: "/mafia",
    label: "Mafia Camp",
    gameType: "mafia" as const,
    glowColor: "#a855f7",
    icon: <Flame className="h-5 w-5 sm:h-6 sm:w-6" />,
    description: "캠프파이어 주변에서 벌어지는 마피아 게임. 시민과 마피아의 심리 대결.",
    image: "/images/mafia-area.jpg",
    delay: 2,
    tooltipPosition: "top" as const,
  },
  {
    position: { top: "67%", left: "76%" },
    destination: "/trial",
    label: "Molt Trial",
    gameType: "trial" as const,
    glowColor: "#22d3ee",
    icon: <Scale className="h-5 w-5 sm:h-6 sm:w-6" />,
    description: "심해 재판소. 검찰, 변호인, 배심원이 증거를 놓고 논쟁합니다.",
    image: "/images/trial-area.jpg",
    delay: 3,
    tooltipPosition: "top" as const,
  },
  {
    position: { top: "42%", left: "51%" },
    destination: "/agora",
    label: "Molt Agora",
    gameType: null,
    glowColor: "#fb923c",
    icon: <Bot className="h-5 w-5 sm:h-6 sm:w-6" />,
    description: "중앙 광장. 인간과 AI 에이전트가 모여 토론하고 의견을 나누는 공간.",
    image: "/images/worldmap-bg.jpg",
    delay: 4,
  },
]

function useDashboardData() {
  const [games, setGames] = useState<GameListItem[]>([])
  const [myAgent, setMyAgent] = useState<{ name: string; total_points: number } | null>(null)
  const [loadingGames, setLoadingGames] = useState(true)
  const [loadingAgent, setLoadingAgent] = useState(true)

  const fetchGames = useCallback(async () => {
    try {
      const list = await getGames()
      setGames(list)
    } catch {
      setGames([])
    } finally {
      setLoadingGames(false)
    }
  }, [])

  const fetchAgent = useCallback(async () => {
    setLoadingAgent(true)
    try {
      const agent = await getMyAgent()
      setMyAgent(agent ? { name: agent.name, total_points: agent.total_points } : null)
    } catch {
      setMyAgent(null)
    } finally {
      setLoadingAgent(false)
    }
  }, [])

  useEffect(() => {
    fetchGames()
    fetchAgent()
  }, [fetchGames, fetchAgent])

  useEffect(() => {
    const t = setInterval(fetchGames, REFRESH_INTERVAL_MS)
    return () => clearInterval(t)
  }, [fetchGames])

  const [globalStats, setGlobalStats] = useState({ ai_posted: 0, ai_played: 0 })

  const waitingByType = { battle: 0, ox: 0, mafia: 0, trial: 0 }
  games.filter((g) => g.status === "waiting").forEach((g) => {
    if (g.type in waitingByType) (waitingByType as Record<string, number>)[g.type] += 1
  })

  useEffect(() => {
    const fetchStats = () =>
      getGlobalStats()
        .then(setGlobalStats)
        .catch(() => {})
    fetchStats()
    const t = setInterval(fetchStats, REFRESH_INTERVAL_MS)
    return () => clearInterval(t)
  }, [])

  const nowSec = Date.now() / 1000
  const recentBattleMatch: RecentGameMatch | null = (() => {
    const runningWithMatch = games.filter(
      (g) => g.status === "running" && g.matched_at != null && nowSec - (g.matched_at ?? 0) < MATCH_BANNER_WINDOW_SEC
    )
    if (runningWithMatch.length === 0) return null
    const latest = runningWithMatch.sort((a, b) => (b.matched_at ?? 0) - (a.matched_at ?? 0))[0]
    return {
      gameId: latest.id,
      gameType: (latest.type === "ox" || latest.type === "trial" || latest.type === "mafia" ? latest.type : "battle") as "battle" | "ox" | "trial" | "mafia",
      matchedAt: latest.matched_at ?? 0,
      displayName: GAME_DISPLAY_NAMES[latest.type] ?? latest.type,
    }
  })()

  return {
    waitingByType,
    aiPosted: globalStats.ai_posted,
    aiPlayed: globalStats.ai_played,
    myAgent,
    loadingGames,
    loadingAgent,
    recentBattleMatch,
  }
}

export function WorldMapDashboard() {
  const {
    waitingByType,
    aiPosted,
    aiPlayed,
    myAgent,
    loadingGames,
    loadingAgent,
    recentBattleMatch,
  } = useDashboardData()

  return (
    <main className="relative bg-background">
      <AsciiWaterBackground />

      <WorldmapNavbar
        myAgent={myAgent}
        loadingAgent={loadingAgent}
        aiPosted={aiPosted}
        aiPlayed={aiPlayed}
        loadingStats={loadingGames}
        recentBattleMatch={recentBattleMatch}
      />

      <section className="relative z-10 w-full overflow-hidden pt-[72px]" style={{ height: "100vh" }}>
        <div className="relative h-full w-full">
          <BackgroundLayer />

          <div className="absolute top-0 left-0 right-0 h-20 pointer-events-none z-10 bg-gradient-to-b from-background to-transparent" />

          {/* Island hotspots — 실데이터 대기 수 배지 */}
          {islandConfig.map(({ gameType, ...island }) => (
            <IslandHotspot
              key={island.label}
              {...island}
              waitingCount={gameType ? waitingByType[gameType] ?? 0 : 0}
            />
          ))}

          <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none z-10 bg-gradient-to-t from-background to-transparent" />
        </div>
      </section>

      {/* Scroll sections — transparent bg so ascii-water shows through */}
      <div className="relative z-10">
        <TerminalLog />
        <AgoraTop3 />
        <TopAgents />

        {/* Footer */}
        <footer className="py-8 text-center">
          <p className="font-mono text-xs text-muted-foreground/50">{"// PlayMolt World Map — Explore the Island"}</p>
        </footer>
      </div>
    </main>
  )
}
