"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion } from "motion/react"
import { getGames, getGameSummary, type GameSummary } from "@/lib/api/games"

interface LogEntry {
  time: string
  type: "BATTLE" | "MAFIA" | "TRIAL" | "OX"
  message: string
}

const badgeColors: Record<string, string> = {
  BATTLE: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  MAFIA: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  TRIAL: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  OX: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
}

const typeMap: Record<string, LogEntry["type"]> = {
  battle: "BATTLE",
  mafia: "MAFIA",
  trial: "TRIAL",
  ox: "OX",
}

function formatTime(iso: string | null): string {
  if (!iso) return "--"
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 16).replace("T", " ")
  } catch {
    return iso.slice(0, 16)
  }
}

function summaryToEntry(s: GameSummary): LogEntry {
  return {
    time: formatTime(s.finished_at),
    type: typeMap[s.game_type?.toLowerCase?.()] ?? "BATTLE",
    message: s.message,
  }
}

export function TerminalLog() {
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setError(null)
    try {
      const games = await getGames({ status: "finished" })
      const toFetch = games.slice(0, 30)
      const summaries = await Promise.all(
        toFetch.map((g) =>
          getGameSummary(g.id).catch(() => ({
            game_id: g.id,
            game_type: g.type,
            finished_at: g.created_at,
            message: "경기 종료",
          }))
        )
      )
      const byTime = (a: GameSummary, b: GameSummary) => {
        const ta = a.finished_at ? new Date(a.finished_at).getTime() : 0
        const tb = b.finished_at ? new Date(b.finished_at).getTime() : 0
        return ta - tb
      }
      summaries.sort(byTime)
      setLogs(summaries.map(summaryToEntry))
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그를 불러오지 못했습니다.")
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 30_000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, paused])

  return (
    <section className="px-4 sm:px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
        >
          <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-lg shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/60 border-b border-border/50">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 font-mono text-[11px] text-muted-foreground">recent-games.log</span>
            </div>

            <div className="relative">
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,100,0.015) 2px, rgba(0,255,100,0.015) 4px)",
                }}
              />

              <div
                ref={scrollRef}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                className="h-[320px] sm:h-[380px] overflow-y-auto p-4 sm:p-6 font-mono text-xs sm:text-sm space-y-1.5 scrollbar-hide"
              >
                {loading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="animate-pulse">Loading...</span>
                  </div>
                ) : error ? (
                  <div className="flex items-center gap-2 text-destructive/80">{error}</div>
                ) : logs.length === 0 ? (
                  <div className="text-muted-foreground">아직 종료된 경기가 없습니다.</div>
                ) : (
                  logs.map((log, i) => (
                    <motion.div
                      key={`${log.time}-${log.type}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-start gap-2 sm:gap-3"
                    >
                      <span className="text-muted-foreground/60 shrink-0">{log.time}</span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${badgeColors[log.type]}`}
                      >
                        {log.type}
                      </span>
                      <span className="text-foreground/80">{log.message}</span>
                    </motion.div>
                  ))
                )}

                {!loading && !error && (
                  <div className="flex items-center gap-1 pt-1">
                    <span className="text-primary/70">{">"}</span>
                    <span className="typing-cursor text-primary/70" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
