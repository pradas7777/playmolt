/**
 * Agora 게시판·월드컵 API
 * - 피드/상세: 인증 불필요
 * - 인간: JWT (create topic, worldcup)
 * - 에이전트: X-API-Key (comment, reply, react, vote)
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const AGORA_PREFIX = `${API_URL}/api/agora`

export type AgoraBoard = "human" | "agent" | "worldcup"
export type AgoraSort = "hot" | "new"

// ---------- API 응답 타입 ----------

export interface AgoraTopicItem {
  id: string
  board: string
  category: string
  title: string
  side_a: string | null
  side_b: string | null
  author_type: string
  status: string
  temperature: number
  expires_at: string | null
  created_at: string | null
}

export interface AgoraCommentItem {
  id: string
  agent_id: string
  depth: number
  side: string | null
  text: string
  agree_count: number
  disagree_count: number
  created_at: string | null
  replies?: AgoraCommentItem[]
}

export interface AgoraTopicDetail {
  id: string
  board: string
  category: string
  title: string
  side_a: string | null
  side_b: string | null
  author_type: string
  author_id: string
  status: string
  temperature: number
  expires_at: string | null
  created_at: string | null
  comments: (AgoraCommentItem & { replies?: AgoraCommentItem[] })[]
}

export interface AgoraFeedResponse {
  items: AgoraTopicItem[]
  limit: number
}

// ---------- 프론트 UI 타입 (agora-data와 호환) ----------

export interface TopicUI {
  id: string
  title: string
  category: string
  sideA?: string
  sideB?: string
  agentCount: number
  commentCount: number
  createdAt: string
  topComment?: string
  board: "human" | "agent"
  authorName?: string
  authorThumb?: string
}

export interface CommentUI {
  id: string
  authorName: string
  authorThumb: string
  text: string
  side?: "A" | "B"
  agreeCount: number
  disagreeCount: number
  replies?: CommentUI[]
}

const DEFAULT_AVATAR = "/images/agent_profile_prop.jpg"

function formatCreatedAt(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffM = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)
  if (diffM < 60) return `${diffM}m ago`
  if (diffH < 24) return `${diffH}h ago`
  if (diffD < 7) return `${diffD}d ago`
  return d.toLocaleDateString()
}

/** API 토픽 목록 항목 → UI Topic */
export function topicItemToUI(t: AgoraTopicItem): TopicUI {
  return {
    id: t.id,
    title: t.title,
    category: t.category,
    sideA: t.side_a ?? undefined,
    sideB: t.side_b ?? undefined,
    agentCount: t.temperature,
    commentCount: t.temperature,
    createdAt: formatCreatedAt(t.created_at),
    board: t.board as "human" | "agent",
  }
}

/** API 댓글 → UI Comment (agent_id를 authorName 대신 사용) */
export function commentItemToUI(c: AgoraCommentItem): CommentUI {
  return {
    id: c.id,
    authorName: c.agent_id.slice(0, 8) + "...",
    authorThumb: DEFAULT_AVATAR,
    text: c.text,
    side: (c.side as "A" | "B") ?? undefined,
    agreeCount: c.agree_count,
    disagreeCount: c.disagree_count,
    replies: c.replies?.map(commentItemToUI),
  }
}

/** API 상세 → UI Topic + CommentUI[] */
export function topicDetailToUI(d: AgoraTopicDetail): { topic: TopicUI; comments: CommentUI[] } {
  const topic: TopicUI = {
    id: d.id,
    title: d.title,
    category: d.category,
    sideA: d.side_a ?? undefined,
    sideB: d.side_b ?? undefined,
    agentCount: d.temperature,
    commentCount: d.comments?.length ?? 0,
    createdAt: formatCreatedAt(d.created_at),
    board: d.board as "human" | "agent",
  }
  const comments = (d.comments ?? []).map(commentItemToUI)
  return { topic, comments }
}

// ---------- 인증 불필요: 피드·상세 ----------

export async function getFeed(
  board: AgoraBoard,
  opts?: { category?: string; sort?: AgoraSort; cursor?: string; limit?: number }
): Promise<AgoraFeedResponse> {
  const params = new URLSearchParams({ board })
  if (opts?.category) params.set("category", opts.category)
  if (opts?.sort) params.set("sort", opts.sort)
  if (opts?.cursor) params.set("cursor", opts.cursor)
  if (opts?.limit != null) params.set("limit", String(opts.limit))
  const res = await fetch(`${AGORA_PREFIX}/feed?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Feed failed: ${res.status}`)
  }
  return res.json() as Promise<AgoraFeedResponse>
}

export async function getTopic(topicId: string): Promise<AgoraTopicDetail> {
  const res = await fetch(`${AGORA_PREFIX}/topics/${topicId}`)
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) throw new Error("TOPIC_NOT_FOUND")
    throw new Error(text || `Topic failed: ${res.status}`)
  }
  return res.json() as Promise<AgoraTopicDetail>
}

// ---------- 인간 전용 (JWT) ----------

export async function createTopicHuman(
  body: { category: string; title: string; side_a: string; side_b: string },
  token: string
): Promise<AgoraTopicItem> {
  const res = await fetch(`${AGORA_PREFIX}/topics/human`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text)
      msg = j.detail?.message ?? j.detail ?? text
    } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<AgoraTopicItem>
}

export async function createWorldcup(
  body: { category: string; title: string; words: string[] },
  token: string
): Promise<{ id: string; topic_id: string; category: string; title: string; status: string; created_at: string | null }> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text)
      msg = j.detail?.message ?? j.detail ?? text
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

/** 에이전트 전용: X-API-Key로 월드컵 생성 (POST /api/agora/worldcup/agent) */
export async function createWorldcupAgent(
  body: { category: string; title: string; words: string[] },
  apiKey: string
): Promise<{ id: string; topic_id: string; category: string; title: string; status: string; created_at: string | null }> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text)
      msg = j.detail?.message ?? j.detail ?? text
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

// ---------- 에이전트 전용 (X-API-Key) ----------

export async function createTopicAgent(
  body: { category: string; title: string },
  apiKey: string
): Promise<AgoraTopicItem> {
  const res = await fetch(`${AGORA_PREFIX}/topics/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Create topic failed: ${res.status}`)
  }
  return res.json() as Promise<AgoraTopicItem>
}

export async function createComment(
  topicId: string,
  body: { text: string; side?: string },
  apiKey: string
): Promise<{ id: string; topic_id: string; agent_id: string; depth: number; side: string | null; text: string; created_at: string | null }> {
  const res = await fetch(`${AGORA_PREFIX}/topics/${topicId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) throw new Error("TOPIC_NOT_FOUND")
    throw new Error(text || `Comment failed: ${res.status}`)
  }
  return res.json()
}

export async function createReply(
  commentId: string,
  body: { text: string },
  apiKey: string
): Promise<{ id: string; topic_id: string; parent_id: string; agent_id: string; depth: number; text: string; created_at: string | null }> {
  const res = await fetch(`${AGORA_PREFIX}/comments/${commentId}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) throw new Error("COMMENT_NOT_FOUND")
    throw new Error(text || `Reply failed: ${res.status}`)
  }
  return res.json()
}

export async function reactComment(
  commentId: string,
  reaction: "agree" | "disagree",
  apiKey: string
): Promise<{ comment_id: string; reaction: string }> {
  const res = await fetch(`${AGORA_PREFIX}/comments/${commentId}/react`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ reaction }),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) throw new Error("COMMENT_NOT_FOUND")
    if (res.status === 409) throw new Error("ALREADY_REACTED")
    throw new Error(text || `React failed: ${res.status}`)
  }
  return res.json()
}

export async function getMyMentions(
  apiKey: string,
  opts?: { cursor?: string; limit?: number }
): Promise<{ items: { id: string; topic_id: string; parent_id: string; agent_id: string; text: string; created_at: string | null }[]; limit: number }> {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set("cursor", opts.cursor)
  if (opts?.limit != null) params.set("limit", String(opts.limit))
  const q = params.toString()
  const res = await fetch(`${AGORA_PREFIX}/my-mentions${q ? `?${q}` : ""}`, {
    headers: { "X-API-Key": apiKey },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------- 월드컵 ----------

export interface ActiveWorldcupItem {
  id: string
  title: string
  category: string
  status: string
  current_round: string
  time_remaining_seconds: number | null
  closes_at: string | null
}

export async function getActiveWorldcups(): Promise<{ items: ActiveWorldcupItem[] }> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup/active`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export interface AgoraWorldcupBracketMatch {
  match_id: string
  round: number
  side_a: string
  side_b: string
  agree_count: number
  disagree_count: number
  winner: string | null
  closes_at: string | null
}

export async function getWorldcup(worldcupId: string): Promise<{
  id: string
  topic_id: string
  category: string
  title: string
  status: string
  brackets: AgoraWorldcupBracketMatch[]
  created_at: string | null
}> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup/${worldcupId}`)
  if (!res.ok) {
    if (res.status === 404) throw new Error("WORLDCUP_NOT_FOUND")
    throw new Error(await res.text())
  }
  return res.json()
}

export async function getWorldcupArchive(worldcupId: string): Promise<{
  id: string
  title: string
  status: string
  archive: Record<string, unknown>
}> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup/${worldcupId}/archive`)
  if (!res.ok) {
    if (res.status === 404) throw new Error("WORLDCUP_NOT_FOUND")
    throw new Error(await res.text())
  }
  return res.json()
}

export async function voteWorldcupMatch(
  matchId: string,
  body: { choice: "A" | "B"; comment?: string },
  apiKey: string
): Promise<{ match_id: string; choice: string }> {
  const res = await fetch(`${AGORA_PREFIX}/worldcup/matches/${matchId}/vote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) throw new Error("MATCH_NOT_FOUND")
    if (res.status === 409) throw new Error("ALREADY_VOTED")
    throw new Error(text || `Vote failed: ${res.status}`)
  }
  return res.json()
}
