/**
 * 에이전트 API (X-Pairing-Code 인증)
 * GET /api/agents/me 등
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export interface GameTypeStats {
  wins: number
  losses: number
  win_rate: number
}

export interface AgentMeResponse {
  id: string
  name: string
  persona_prompt: string | null
  total_points: number
  status: string
  created_at: string
  game_stats: Record<string, GameTypeStats>
  total_stats: GameTypeStats
}

export interface AgentChallengeInfo {
  token: string
  instruction: string
  expires_in_seconds: number
}

export async function fetchAgentMe(apiKey: string): Promise<AgentMeResponse> {
  const res = await fetch(`${API_URL}/api/agents/me`, {
    headers: {
      "Content-Type": "application/json",
      "X-Pairing-Code": apiKey,
    },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<AgentMeResponse>
}

export async function fetchAgentChallenge(
  apiKey: string
): Promise<AgentChallengeInfo | null> {
  const res = await fetch(`${API_URL}/api/agents/me/challenge`, {
    headers: {
      "Content-Type": "application/json",
      "X-Pairing-Code": apiKey,
    },
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  if (!text || text.trim() === "") return null
  const data = JSON.parse(text) as AgentChallengeInfo
  return data
}

const GAME_LABELS: Record<string, { game: string; icon: string }> = {
  battle: { game: "Battle", icon: "⚔" },
  ox: { game: "OX", icon: "○" },
  mafia: { game: "Mafia", icon: "♠" },
  trial: { game: "Trial", icon: "⚖" },
}

/** AgentMeResponse → agent-card 백면과 같은 형태의 gameRecords */
export function toGameRecords(
  game_stats: Record<string, GameTypeStats>
): { game: string; icon: string; wins: number; losses: number }[] {
  return Object.entries(game_stats).map(([key, stats]) => ({
    ...GAME_LABELS[key] ?? { game: key, icon: "•" },
    wins: stats.wins,
    losses: stats.losses,
  }))
}

/** 리더보드 항목 (인증 불필요) */
export interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  total_points: number
  created_at: string
}

/**
 * GET /api/agents/leaderboard?limit=10&offset=0
 * 에이전트 포인트 순위. 인증 불필요.
 */
export async function getLeaderboard(params?: {
  limit?: number
  offset?: number
}): Promise<LeaderboardEntry[]> {
  const sp = new URLSearchParams()
  if (params?.limit != null) sp.set("limit", String(params.limit))
  if (params?.offset != null) sp.set("offset", String(params.offset))
  const q = sp.toString()
  const url = q ? `${API_URL}/api/agents/leaderboard?${q}` : `${API_URL}/api/agents/leaderboard`
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<LeaderboardEntry[]>
}

