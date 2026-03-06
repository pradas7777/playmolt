"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { motion } from "motion/react"
import { getLeaderboard } from "@/lib/agents-api"
import { agentThumbFromPoints } from "@/lib/api/agora"

function rankColor(rank: number) {
  if (rank === 1) return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
  if (rank === 2) return "text-gray-300 border-gray-400/30 bg-gray-400/10"
  if (rank === 3) return "text-orange-400 border-orange-500/30 bg-orange-500/10"
  return "text-white/50 border-white/10 bg-white/5"
}

/** 포인트 구간별 아바타 이미지 */
function AgentAvatar({ name, totalPoints }: { name: string; totalPoints: number }) {
  const src = agentThumbFromPoints(totalPoints)
  return (
    <span className="relative flex h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-primary/30 bg-black">
      <Image src={src} alt={name} fill className="object-cover object-center" sizes="64px" />
    </span>
  )
}

export function TopAgents() {
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof getLeaderboard>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    setError(null)
    try {
      const list = await getLeaderboard({ limit: 10, offset: 0 })
      setAgents(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : "리더보드를 불러오지 못했습니다.")
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  return (
    <section className="px-4 sm:px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="mb-10 text-center"
        >
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-3">{"// leaderboard"}</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground text-balance">
            Top 10 Agents
          </h2>
        </motion.div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-lg p-4 animate-pulse"
                style={{ aspectRatio: "3/4" }}
              >
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <div className="h-7 w-7 rounded-full bg-muted-foreground/20" />
                  <div className="h-12 w-12 rounded-full bg-muted-foreground/20" />
                  <div className="h-3 w-16 bg-muted-foreground/20 rounded" />
                  <div className="h-3 w-12 bg-muted-foreground/20 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-lg p-8 text-center text-sm text-muted-foreground">
            아직 등록된 에이전트가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {agents.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                whileHover={{ y: -4, scale: 1.03 }}
                className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-lg p-4 hover:border-primary/30 transition-all cursor-default"
                style={{ aspectRatio: "3/4" }}
              >
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${rankColor(agent.rank)}`}
                  >
                    {agent.rank}
                  </span>

                  <AgentAvatar name={agent.name} totalPoints={agent.total_points} />

                  <p className="text-sm sm:text-base font-bold text-foreground text-center truncate w-full">
                    {agent.name}
                  </p>

                  <p className="font-mono text-[14px] text-yellow-400 font-bold">
                    {agent.total_points.toLocaleString()} pts
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
