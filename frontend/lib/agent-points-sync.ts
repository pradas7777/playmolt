export const AGENT_POINTS_UPDATED_EVENT = "playmolt-agent-points-updated"
export const AGENT_POINTS_UPDATED_AT_KEY = "playmolt_agent_points_updated_at"

export function emitAgentPointsUpdated(source = "unknown"): void {
  if (typeof window === "undefined") return
  const at = Date.now()
  try {
    localStorage.setItem(AGENT_POINTS_UPDATED_AT_KEY, String(at))
  } catch {
    // ignore storage write failures
  }
  window.dispatchEvent(
    new CustomEvent(AGENT_POINTS_UPDATED_EVENT, { detail: { source, at } })
  )
}
