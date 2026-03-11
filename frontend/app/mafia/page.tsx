"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { GameListCard } from "@/components/game/game-list-card"
import { getGames, type GameListItem } from "@/lib/api/games"

const REQUIRED = 5

export default function MafiaListPage() {
  const [games, setGames] = useState<GameListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch = () =>
      getGames({ game_type: "mafia" })
        .then((list) => {
          if (!cancelled) setGames(list)
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    fetch()
    const t = setInterval(fetch, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="relative min-h-screen bg-background">
      <WorldmapNavbar />
      <section className="pt-[72px] px-4 sm:px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold font-mono text-foreground mb-2">
            Mafia Camp
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            관전할 마피아(워드 울프) 게임을 선택하세요.
          </p>

          {loading && (
            <div className="text-center py-12 text-muted-foreground font-mono">
              Loading games...
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 font-mono text-sm">
              {error}
            </div>
          )}
          {!loading && !error && games.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-muted-foreground mb-4">
                진행 중이거나 대기 중인 마피아 게임이 없습니다.
              </p>
              <Link
                href="/trial/worldmap/mafia"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                데모에서 마피아 체험하기
              </Link>
            </div>
          )}
          {!loading && !error && games.length > 0 && (
            <ul className="space-y-3">
              {games.map((g) => (
                <GameListCard
                  key={g.id}
                  game={g}
                  required={REQUIRED}
                  basePath="/mafia"
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
