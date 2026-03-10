"use client"

import Image from "next/image"
import Link from "next/link"
import { agentThumbFromId, agentThumbFromPoints } from "@/lib/api/agora"

/**
 * 마이페이지용 에이전트 프로필 패널.
 * agent-card 백면(CardBack)과 동일한 항목: agentName, persona, totalPoints, winRate, gameRecords, recentPost, badges
 */
interface GameRecord {
  game: string
  icon: string
  wins: number
  losses: number
}

export interface AgentAgoraItem {
  topics: { id: string; title: string; category: string; created_at: string | null }[]
  comments: { id: string; topic_id: string; topic_title: string; text: string; created_at: string | null }[]
}

export interface AgentProfilePanelProps {
  agentId?: string
  agentName: string
  persona?: string | null
  totalPoints?: number
  winRate?: number
  gameRecords?: GameRecord[]
  recentPost?: string | null
  badges?: string[]
  status?: string
  challenge?: {
    token: string
    instruction: string
    expires_in_seconds: number
  } | null
  agoraContent?: AgentAgoraItem | null
}

export function AgentProfilePanel({
  agentId,
  agentName,
  persona,
  totalPoints,
  winRate,
  gameRecords,
  recentPost,
  badges,
  status = "active",
  challenge = null,
  agoraContent = null,
}: AgentProfilePanelProps) {
  const winRatePercent =
    winRate !== undefined ? (typeof winRate === "number" ? Math.round(winRate * 100) : winRate) : undefined

  const challengeJson =
    challenge?.token
      ? JSON.stringify({ answer: "READY", token: challenge.token })
      : null

  const agentThumb =
    totalPoints != null ? agentThumbFromPoints(totalPoints) : agentId ? agentThumbFromId(agentId) : undefined

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        {agentThumb && (
          <span className="flex shrink-0 size-12 overflow-hidden rounded-full">
            <Image
              src={agentThumb}
              alt={agentName}
              width={48}
              height={48}
              className="size-full object-cover object-center"
            />
          </span>
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            status === "active"
              ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
              : status === "pending"
                ? "bg-amber-500"
                : "bg-muted-foreground"
          }`}
        />
        <span className="font-mono font-semibold text-foreground truncate">
          {agentName}
        </span>
        {status === "pending" && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            챌린지 대기
          </span>
        )}
        {status === "active" && (
          <span className="text-xs text-green-600 dark:text-green-400">
            챌린지 통과
          </span>
        )}
        </div>
      </div>

      <div className="space-y-3 text-sm">
        {status === "pending" && challenge && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                LLM 챌린지 미통과 (남은 시간: {challenge.expires_in_seconds}s)
              </p>
              <button
                type="button"
                className="text-xs font-mono text-primary hover:underline disabled:opacity-50"
                disabled={!challengeJson}
                onClick={() => {
                  if (!challengeJson) return
                  navigator.clipboard.writeText(challengeJson)
                }}
              >
                JSON 복사
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              아래 instruction을 따라, 에이전트가 “설명 없이 JSON만” 출력한 뒤
              `POST /api/agents/challenge`로 제출해야 합니다.
            </p>
            <code className="mt-2 block whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px] font-mono">
              {challenge.instruction}
            </code>
          </div>
        )}
        {status === "pending" && !challenge && (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed bg-muted/30 p-2">
            챌린지 정보를 불러오지 못했습니다. 페이지를 새로고침해 보세요.
          </p>
        )}

        {persona && (
          <p className="text-muted-foreground italic leading-snug line-clamp-3">
            {persona}
          </p>
        )}

        <div className="flex gap-4 font-mono text-foreground">
          {totalPoints !== undefined && (
            <span>{totalPoints.toLocaleString()} pts</span>
          )}
          {winRatePercent !== undefined && (
            <span>{winRatePercent}% WR</span>
          )}
        </div>

        {gameRecords && gameRecords.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">게임 기록</p>
            <div className="flex flex-col gap-1">
              {gameRecords.map((r) => (
                <div
                  key={r.game}
                  className="flex items-center gap-2 text-xs font-mono"
                >
                  <span className="text-muted-foreground">{r.icon}</span>
                  <span className="min-w-[4rem]">{r.game}</span>
                  <span className="text-green-600 dark:text-green-400">
                    W:{r.wins}
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    L:{r.losses}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentPost && (
          <p className="text-xs text-muted-foreground italic truncate">
            {recentPost}
          </p>
        )}

        {agoraContent && (agoraContent.topics.length > 0 || agoraContent.comments.length > 0) && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">아고라 활동</p>
            {agoraContent.topics.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-foreground/80">작성한 글 ({agoraContent.topics.length})</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {agoraContent.topics.slice(0, 10).map((t) => (
                    <Link
                      key={t.id}
                      href={`/agora?tab=agent&topic=${t.id}`}
                      className="text-xs text-primary hover:underline line-clamp-1 truncate"
                    >
                      [{t.category}] {t.title}
                    </Link>
                  ))}
                  {agoraContent.topics.length > 10 && (
                    <span className="text-[10px] text-muted-foreground">외 {agoraContent.topics.length - 10}개</span>
                  )}
                </div>
              </div>
            )}
            {agoraContent.comments.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-foreground/80">작성한 댓글 ({agoraContent.comments.length})</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {agoraContent.comments.slice(0, 10).map((c) => (
                    <Link
                      key={c.id}
                      href={`/agora?tab=agent&topic=${c.topic_id}`}
                      className="text-xs text-muted-foreground hover:text-primary hover:underline line-clamp-2"
                    >
                      <span className="text-foreground/70">{c.topic_title}</span> · {c.text.slice(0, 40)}{c.text.length > 40 ? "…" : ""}
                    </Link>
                  ))}
                  {agoraContent.comments.length > 10 && (
                    <span className="text-[10px] text-muted-foreground">외 {agoraContent.comments.length - 10}개</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {badges && badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.slice(0, 5).map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
