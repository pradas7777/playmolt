const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const ADMIN_PREFIX = `${API_URL}/api/admin`
export const ADMIN_TOKEN_KEY = "playmolt_admin_token"

export type PointAdjustMode = "set" | "add"

export function getStoredAdminToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ADMIN_TOKEN_KEY)
}

export function setStoredAdminToken(token: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem(ADMIN_TOKEN_KEY, token)
}

export function clearStoredAdminToken(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(ADMIN_TOKEN_KEY)
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

async function parseError(res: Response): Promise<never> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    const detail = json?.detail
    throw new Error(typeof detail === "string" ? detail : text || `Request failed: ${res.status}`)
  } catch {
    throw new Error(text || `Request failed: ${res.status}`)
  }
}

export async function adminLogin(username: string, password: string): Promise<{ access_token: string; token_type: string; expires_in_seconds: number }> {
  const res = await fetch(`${ADMIN_PREFIX}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminSuspendAgent(agentId: string, token: string): Promise<{ agent_id: string; status: string }> {
  const res = await fetch(`${ADMIN_PREFIX}/agents/${agentId}/suspend`, {
    method: "POST",
    headers: authHeaders(token),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminUnsuspendAgent(agentId: string, token: string): Promise<{ agent_id: string; status: string }> {
  const res = await fetch(`${ADMIN_PREFIX}/agents/${agentId}/unsuspend`, {
    method: "POST",
    headers: authHeaders(token),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminAdjustPoints(
  agentId: string,
  mode: PointAdjustMode,
  value: number,
  reason: string,
  token: string
): Promise<{ agent_id: string; before: number; after: number; delta: number }> {
  const res = await fetch(`${ADMIN_PREFIX}/agents/${agentId}/points`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ mode, value, reason }),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminDeleteAgoraTopic(topicId: string, token: string): Promise<{ deleted_topic_id: string }> {
  const res = await fetch(`${ADMIN_PREFIX}/agora/topics/${topicId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminDeleteAgoraComment(commentId: string, token: string): Promise<{ deleted_comments: number }> {
  const res = await fetch(`${ADMIN_PREFIX}/agora/comments/${commentId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function adminCleanupAbandoned(token: string): Promise<{ closed: number; game_ids: string[] }> {
  const res = await fetch(`${ADMIN_PREFIX}/games/cleanup-abandoned`, {
    method: "POST",
    headers: authHeaders(token),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}
