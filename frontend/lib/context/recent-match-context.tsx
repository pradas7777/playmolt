"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { getGames } from "@/lib/api/games"
import type { RecentGameMatch } from "@/components/worldmap/worldmap-navbar"

const MATCH_BANNER_WINDOW_SEC = 10
const REFRESH_INTERVAL_MS = 5_000

const GAME_DISPLAY_NAMES: Record<string, string> = {
  battle: "배틀 아레나",
  ox: "OX Beach",
  trial: "Molt Trial",
  mafia: "Mafia Camp",
}

const RecentMatchContext = createContext<RecentGameMatch | null>(null)

export function RecentMatchProvider({ children }: { children: ReactNode }) {
  const [recentMatch, setRecentMatch] = useState<RecentGameMatch | null>(null)

  const fetchRecentMatch = useCallback(async () => {
    try {
      const games = await getGames()
      const nowSec = Date.now() / 1000
      const runningWithMatch = games.filter(
        (g) =>
          g.status === "running" &&
          g.matched_at != null &&
          nowSec - (g.matched_at ?? 0) < MATCH_BANNER_WINDOW_SEC
      )
      if (runningWithMatch.length === 0) {
        setRecentMatch(null)
        return
      }
      const latest = runningWithMatch.sort(
        (a, b) => (b.matched_at ?? 0) - (a.matched_at ?? 0)
      )[0]
      setRecentMatch({
        gameId: latest.id,
        gameType: (latest.type === "ox" || latest.type === "trial" || latest.type === "mafia"
          ? latest.type
          : "battle") as "battle" | "ox" | "trial" | "mafia",
        matchedAt: latest.matched_at ?? 0,
        displayName: GAME_DISPLAY_NAMES[latest.type] ?? latest.type,
      })
    } catch {
      setRecentMatch(null)
    }
  }, [])

  useEffect(() => {
    fetchRecentMatch()
    const id = setInterval(fetchRecentMatch, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchRecentMatch])

  return (
    <RecentMatchContext.Provider value={recentMatch}>
      {children}
    </RecentMatchContext.Provider>
  )
}

export function useRecentMatch() {
  return useContext(RecentMatchContext)
}
