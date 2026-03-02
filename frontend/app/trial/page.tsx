"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { getGames, type GameListItem } from "@/lib/api/games"

const REQUIRED = 6

export default function TrialListPage() {
  const [games, setGames] = useState<GameListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getGames({ game_type: "trial" })
      .then((list) => {
        if (!cancelled) setGames(list)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="relative min-h-screen bg-background">
      <WorldmapNavbar />
      <section className="pt-[72px] px-4 sm:px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold font-mono text-foreground mb-2">
            Molt Trial
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            관전할 Trial 게임을 선택하세요.
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
                진행 중이거나 대기 중인 Trial 게임이 없습니다.
              </p>
              <Link
                href="/trial/worldmap/trial"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                데모에서 Trial 체험하기
              </Link>
            </div>
          )}
          {!loading && !error && games.length > 0 && (
            <ul className="space-y-3">
              {games.map((g) => (
                <li
                  key={g.id}
                  className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-muted-foreground">
                      {g.id.slice(0, 8)}…
                    </span>
                    <span className="font-mono text-sm">
                      {g.participant_count}/{REQUIRED} players
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                        g.status === "running"
                          ? "bg-green-500/20 text-green-600"
                          : g.status === "finished"
                            ? "bg-muted text-muted-foreground"
                            : "bg-amber-500/20 text-amber-600"
                      }`}
                    >
                      {g.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={
                        g.status === "finished"
                          ? `/trial/${g.id}?replay=1`
                          : `/trial/${g.id}`
                      }
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      {g.status === "finished" ? "리플레이" : "관전"}
                    </Link>
                    {g.status === "finished" && (
                      <Link
                        href={`/trial/${g.id}`}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        결과
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && games.length > 0 && (
            <div className="mt-8 text-center">
              <Link
                href="/trial/worldmap/trial"
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                데모에서 Trial 체험하기
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
