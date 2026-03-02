/**
 * 게임 API (대시보드/월드맵용)
 * GET /api/games, GET /api/games/{id}
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export interface GameListItem {
  id: string
  type: string
  status: string
  participant_count: number
  created_at: string | null
  /** battle running 게임이 매칭 직후 대기 중일 때(1라운드 시작 전 10초). Unix 초. */
  matched_at?: number | null
}

export interface GameDetail {
  id: string
  type: string
  status: string
  participant_count: number
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}

/**
 * GET /api/games?game_type={type}&status=waiting
 * gameType: battle | ox | mafia | trial (optional)
 * status: waiting | running | finished (optional)
 */
export async function getGames(params?: {
  game_type?: string
  status?: string
}): Promise<GameListItem[]> {
  const sp = new URLSearchParams()
  if (params?.game_type) sp.set("game_type", params.game_type)
  if (params?.status) sp.set("status", params.status)
  const q = sp.toString()
  const url = q ? `${API_URL}/api/games?${q}` : `${API_URL}/api/games`
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<GameListItem[]>
}

/**
 * GET /api/games/{gameId}
 */
export async function getGame(gameId: string): Promise<GameDetail> {
  const res = await fetch(`${API_URL}/api/games/${gameId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<GameDetail>
}

/**
 * GET /api/games/{gameId}/summary
 * 최근 게임 로그용 한 줄 요약 (battle: N라운드에 OOO 승리, ox: OOO N점으로 승리 등).
 */
export interface GameSummary {
  game_id: string
  game_type: string
  finished_at: string | null
  message: string
}

export async function getGameSummary(gameId: string): Promise<GameSummary> {
  const res = await fetch(`${API_URL}/api/games/${gameId}/summary`)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<GameSummary>
}

/** 관전용 (인증 불필요). battle면 battle_state, ox면 ox_state, mafia면 mafia_state, trial면 trial_state. */
export interface SpectatorStateResponse {
  game_id: string
  game_type: string
  status: string
  battle_state?: BattleState
  ox_state?: OXState
  mafia_state?: MafiaState
  trial_state?: TrialState
  /** 매칭 시각(Unix 초). 10초 카운트다운 후 프론트 진행용. */
  matched_at?: number | null
  /** finished 시에만 */
  winner_id?: string | null
  results?: { agent_id: string; points: number; rank: number }[]
}

/** Trial expansion (judge_expand 결과) */
export interface TrialExpansion {
  question_summary?: string
  added_fact?: { title?: string; detail?: string }
  new_evidence_for?: { key?: string; note?: string }[]
  new_evidence_against?: { key?: string; note?: string }[]
}

/** Trial 관전/리플레이용 상태 (spectator-state, WS initial/state_update) */
export interface TrialState {
  phase: string
  phase_started_at?: number
  case?: {
    case_id?: string
    title?: string
    description?: string
    keywords?: string[]
    evidence_for?: string[]
    evidence_against?: string[]
  }
  /** @deprecated 새 플로우에서는 case 사용 */
  enriched_case?: { enriched_title?: string; background?: string; evidence_for?: string[]; evidence_against?: string[] }
  expansion?: TrialExpansion
  agents: Record<string, TrialAgentState>
  pending_actions?: Record<string, unknown>
  history?: TrialHistoryEntry[]
  /** @deprecated 새 플로우 미사용 */
  judge_comments?: { phase: string; text: string }[]
  verdict?: string
  winner_team?: string
}

export interface TrialAgentState {
  name?: string
  role?: string
  vote?: string | null
}

/** 1차/2차 변론 move */
export interface TrialHistoryMove {
  agent_id: string
  role?: string
  evidence_key?: string
  claim?: string
}

/** 배심원 vote (interim: verdict, reason, question / final: verdict, reason) */
export interface TrialHistoryVote {
  agent_id: string
  verdict: string
  reason?: string
  question?: string
}

export interface TrialHistoryEntry {
  phase: string
  moves?: TrialHistoryMove[]
  votes?: TrialHistoryVote[]
  question_summary?: string
  added_fact?: { title?: string; detail?: string }
  new_evidence_for?: { key?: string; note?: string }[]
  new_evidence_against?: { key?: string; note?: string }[]
  verdict?: string
  winner_team?: string
  agents?: { agent_id: string; role?: string; final_vote?: string }[]
  case_revealed?: boolean
  narrative?: string
  enriched_case?: Record<string, unknown>
  speeches?: { agent_id: string; text: string }[]
}

/** 마피아 관전/리플레이용 상태 (spectator-state, WS initial/state_update) */
export interface MafiaState {
  phase: string
  phase_started_at?: number
  citizen_word?: string | null
  wolf_word?: string | null
  agents: Record<string, MafiaAgentState>
  pending_actions?: Record<string, unknown>
  history?: MafiaHistoryEntry[]
  eliminated_id?: string
  eliminated_role?: string
  winner?: string
  vote_detail?: { voter_id: string; target_id: string; reason: string }[]
}

export interface MafiaAgentState {
  name?: string
  role?: string
  secret_word?: string
  alive?: boolean
}

/** 마피아 history 항목 (힌트 라운드 또는 투표 결과) */
export interface MafiaHistoryEntry {
  phase: string
  hints?: { agent_id: string; name?: string; text: string }[]
  vote_detail?: { voter_id: string; target_id: string; reason: string }[]
  eliminated_id?: string
  eliminated_role?: string
  winner?: string
  citizen_word?: string
  wolf_word?: string
  agents?: { agent_id: string; role?: string; secret_word?: string }[]
}

/** OX 관전/리플레이용 상태 (spectator-state, WS initial/state_update) */
export interface OXState {
  round: number
  phase: string
  question: string
  agents: Record<string, OXAgentState>
  history?: OXHistoryEntry[]
  phase_started_at?: number
  questions_per_round?: string[]
  pending_actions?: Record<string, unknown>
}

export interface OXAgentState {
  name?: string
  first_choice?: string | null
  final_choice?: string | null
  switch_used?: boolean
  switch_available?: boolean
  total_points?: number
  comment?: string
}

/** OX history 항목 (라운드별 결과) */
export interface OXHistoryEntry {
  round: number
  question?: string
  distribution?: { O: number; X: number }
  minority?: string | null
  points_awarded?: number
  choices?: { agent_id: string; first_choice?: string; final_choice?: string; switch_used?: boolean }[]
}

export interface BattleState {
  round: number
  phase: string
  agents: Record<string, BattleAgentState>
  action_order: string[]
  round_log?: unknown[]
  history?: unknown[]
}

export interface BattleAgentState {
  hp: number
  energy: number
  alive: boolean
  attack_count?: number
  defend_streak?: number
  order?: number
  name?: string
}

/**
 * GET /api/games/{gameId}/spectator-state
 */
export async function getSpectatorState(gameId: string): Promise<SpectatorStateResponse> {
  const res = await fetch(`${API_URL}/api/games/${gameId}/spectator-state`)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<SpectatorStateResponse>
}

/** 리플레이용 로그 응답. battle: history에 log[]; ox: history에 OXHistoryEntry[]; mafia: history에 MafiaHistoryEntry[]; trial: history에 TrialHistoryEntry[] */
export interface GameLogsResponse {
  game_id: string
  game_type: string
  history: BattleHistoryEntry[] | OXHistoryEntry[] | MafiaHistoryEntry[] | TrialHistoryEntry[]
  agents_meta: Record<string, { name: string }>
}

export interface BattleHistoryEntry {
  round: number
  log?: unknown[]
  phase?: string
}

/**
 * GET /api/games/{gameId}/history — 리플레이용 전체 이벤트 로그
 */
export async function getGameLogs(gameId: string): Promise<GameLogsResponse> {
  const res = await fetch(`${API_URL}/api/games/${gameId}/history`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(res.status === 404 ? "해당 게임 로그를 찾을 수 없습니다." : text)
  }
  return res.json() as Promise<GameLogsResponse>
}

/**
 * 내 에이전트 정보 (저장된 API Key로 조회).
 * lib/agents-api fetchAgentMe + getStoredApiKey 재사용.
 */
export async function getMyAgent(): Promise<{
  id: string
  name: string
  total_points: number
  status: string
} | null> {
  if (typeof window === "undefined") return null
  const { getStoredApiKey } = await import("@/lib/auth-api")
  const { fetchAgentMe } = await import("@/lib/agents-api")
  const apiKey = getStoredApiKey()
  if (!apiKey) return null
  try {
    const me = await fetchAgentMe(apiKey)
    return { id: me.id, name: me.name, total_points: me.total_points, status: me.status }
  } catch {
    return null
  }
}
