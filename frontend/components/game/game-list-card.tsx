"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { getGameSummary, type GameListItem, type GameSummary } from "@/lib/api/games"

const TYPE_DISPLAY: Record<string, string> = {
  battle: "BATTLE",
  ox: "OX",
  trial: "TRIAL",
  mafia: "MAFIA",
}

function formatTime(iso: string | null): string {
  if (!iso) return "--"
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 16).replace("T", " ")
  } catch {
    return (iso || "").slice(0, 16)
  }
}

function buildRoomTitle(
  g: GameListItem,
  required: number,
  summary: GameSummary | null
): string {
  const prefix = `${g.participant_count}/${required} players`
  if (g.status !== "finished" || !summary) {
    return prefix
  }
  const typeStr = TYPE_DISPLAY[g.type?.toLowerCase?.()] ?? g.type?.toUpperCase?.() ?? "GAME"
  return `${prefix} ->${formatTime(summary.finished_at)} ${typeStr} ${summary.message}`
}

export interface GameListCardProps {
  game: GameListItem
  required: number
  basePath: string
}

export function GameListCard({ game, required, basePath }: GameListCardProps) {
  const [summary, setSummary] = useState<GameSummary | null>(null)

  useEffect(() => {
    if (game.status !== "finished") return
    getGameSummary(game.id)
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [game.id, game.status])

  const title = buildRoomTitle(game, required, summary)
  const isFinished = game.status === "finished"
  const href = isFinished ? `${basePath}/${game.id}?replay=1` : `${basePath}/${game.id}`
  const showWaitingPanel = game.status === "waiting" && (game.participant_names?.length ?? 0) > 0

  return (
    <li className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="font-mono text-sm text-foreground truncate" title={title}>
            {title}
          </span>
          <span
            className={`inline-flex w-fit rounded px-2 py-0.5 text-xs font-bold uppercase ${
              game.status === "running"
                ? "bg-green-500/20 text-green-600"
                : game.status === "finished"
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/20 text-amber-600"
            }`}
          >
            {game.status}
          </span>
        </div>
        <Link
          href={href}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isFinished ? "리플레이" : "관전"}
        </Link>
      </div>
      {showWaitingPanel && (
        <div className="border-t border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 shrink-0">
              대기중 <span className="tabular-nums">({game.participant_count}/{required})</span>
            </span>
            <span className="text-muted-foreground/60">:</span>
            <span className="text-sm text-foreground/90">
              {game.participant_names!.join(", ")}
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
