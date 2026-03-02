/**
 * 마피아 게임: API/WS mafia_state → UI 상태 매핑
 */

import type { MafiaState, MafiaAgentState, MafiaHistoryEntry } from "@/lib/api/games"
import type { MafiaPhase } from "@/components/mafia/mafia-round-info"
import type { MafiaAgent } from "@/components/mafia/mafia-card-grid"
import type { MafiaLogEntry } from "@/components/mafia/mafia-terminal-log"

const DEFAULT_AVATAR = "/images/cards/mafia_game_prop.jpg"

/** 백엔드 phase → 프론트 MafiaPhase */
export function mapMafiaPhase(phase: string): MafiaPhase {
  switch (phase) {
    case "hint_1":
      return "HINT_ROUND_1"
    case "hint_2":
      return "HINT_ROUND_2"
    case "hint_3":
      return "HINT_ROUND_3"
    case "vote":
      return "VOTE"
    case "result":
    case "end":
      return "REVEAL"
    case "waiting":
      return "WORD_ASSIGNED"
    default:
      return "WORD_ASSIGNED"
  }
}

/** history에서 에이전트별 힌트 텍스트 배열 [라운드1, 라운드2, 라운드3] 추출 */
function getHintsFromHistory(agentId: string, history: MafiaHistoryEntry[] | undefined): string[] {
  const hints: string[] = []
  if (!history) return hints
  for (const h of history) {
    if (h.phase?.startsWith("hint_") && h.hints) {
      const entry = h.hints.find((x) => x.agent_id === agentId)
      hints.push(entry?.text ?? "")
    }
  }
  return hints
}

/** vote_detail에서 이 에이전트가 지목한 대상 id */
function getVoteTargetId(agentId: string, voteDetail: MafiaState["vote_detail"]): string | null {
  if (!voteDetail) return null
  const row = voteDetail.find((r) => r.voter_id === agentId)
  return row?.target_id ?? null
}

/** 현재 phase가 hint일 때 pending_actions에서 해당 라운드 힌트 채우기 (history에는 전환 시점에만 추가됨) */
function getHintsWithPending(
  agentId: string,
  history: MafiaState["history"],
  phase: string,
  pendingActions: MafiaState["pending_actions"]
): string[] {
  const hints = getHintsFromHistory(agentId, history)
  while (hints.length < 3) hints.push("")
  const roundIndex = phase === "hint_1" ? 0 : phase === "hint_2" ? 1 : phase === "hint_3" ? 2 : -1
  if (roundIndex >= 0 && pendingActions) {
    const act = pendingActions[agentId] as { text?: string } | undefined
    if (act?.text != null) hints[roundIndex] = act.text
  }
  return hints
}

/** mafia_state.agents → MafiaAgent[] (관전용: result/end 전까지 role/word 마스킹) */
export function mapMafiaAgentsToUI(
  ms: MafiaState,
  agentsMeta?: Record<string, { name: string }>
): MafiaAgent[] {
  const agents = ms.agents ?? {}
  const history = ms.history ?? []
  const phase = ms.phase ?? "waiting"
  const isReveal = phase === "result" || phase === "end"
  const voteDetail = ms.vote_detail
  const eliminatedId = ms.eliminated_id
  const pendingActions = ms.pending_actions

  const list = Object.entries(agents).map(([id, a]) => {
    const role = a.role === "WOLF" ? "WOLF" : "SHEEP"
    const word = isReveal && a.secret_word != null ? a.secret_word : "?"
    const hints = getHintsWithPending(id, history, phase, pendingActions)
    const targetId = getVoteTargetId(id, voteDetail)
    const targetName = targetId && (agents[targetId]?.name ?? agentsMeta?.[targetId]?.name) ? (agents[targetId]?.name ?? agentsMeta?.[targetId]?.name) : undefined
    return {
      id,
      name: (a as MafiaAgentState & { name?: string }).name ?? agentsMeta?.[id]?.name ?? id,
      characterImage: DEFAULT_AVATAR,
      word,
      role: role as "WOLF" | "SHEEP",
      hints,
      voteTarget: targetName,
      eliminated: !(a.alive ?? true) || id === eliminatedId,
      roleRevealed: isReveal,
      isSpeaking: false,
    }
  })
  return list
}

export interface MappedMafiaUI {
  round: number
  maxRound: number
  phase: MafiaPhase
  agents: MafiaAgent[]
  phaseStartedAt: number | null
  citizenWord: string | null
  wolfWord: string | null
  eliminatedId: string | null
  eliminatedRole: string | null
  winner: string | null
  voteDetail: MafiaState["vote_detail"]
}

/** mafia_state → 관전/리플레이용 UI 상태 */
export function mapMafiaStateToUI(ms: MafiaState | undefined, agentsMeta?: Record<string, { name: string }>): MappedMafiaUI {
  if (!ms) {
    return {
      round: 1,
      maxRound: 3,
      phase: "WORD_ASSIGNED",
      agents: [],
      phaseStartedAt: null,
      citizenWord: null,
      wolfWord: null,
      eliminatedId: null,
      eliminatedRole: null,
      winner: null,
      voteDetail: [],
    }
  }
  const phase = mapMafiaPhase(ms.phase ?? "waiting")
  const round =
    phase === "HINT_ROUND_1" ? 1 : phase === "HINT_ROUND_2" ? 2 : phase === "HINT_ROUND_3" ? 3 : phase === "VOTE" ? 4 : 5
  const agents = mapMafiaAgentsToUI(ms, agentsMeta)
  return {
    round,
    maxRound: 5,
    phase,
    agents,
    phaseStartedAt: ms.phase_started_at ?? null,
    citizenWord: ms.citizen_word ?? null,
    wolfWord: ms.wolf_word ?? null,
    eliminatedId: ms.eliminated_id ?? null,
    eliminatedRole: ms.eliminated_role ?? null,
    winner: ms.winner ?? null,
    voteDetail: ms.vote_detail ?? [],
  }
}

/** 리플레이용: history + agents_meta → 적용할 MafiaState 스텝 배열 (hint_1 → hint_2 → hint_3 → vote → result) */
export function buildMafiaReplaySteps(
  history: MafiaHistoryEntry[],
  agentsMeta: Record<string, { name: string }>
): MafiaState[] {
  if (!history.length) return []
  const voteResult = history.find((h) => h.phase === "vote_result") as (MafiaHistoryEntry & {
    agents?: { agent_id: string; role?: string; secret_word?: string }[]
  }) | undefined
  const hintEntries = history.filter((h) => h.phase?.startsWith("hint_"))

  if (!voteResult?.agents?.length) return []

  const steps: MafiaState[] = []
  const agentIds = Object.keys(agentsMeta)

  const buildAgentsFromVoteResult = (): Record<string, MafiaAgentState & { name?: string }> => {
    const out: Record<string, MafiaAgentState & { name?: string }> = {}
    if (voteResult?.agents) {
      for (const a of voteResult.agents) {
        out[a.agent_id] = {
          name: agentsMeta[a.agent_id]?.name ?? a.agent_id,
          role: a.role,
          secret_word: a.secret_word,
          alive: voteResult.eliminated_id !== a.agent_id,
        }
      }
    }
    for (const id of agentIds) {
      if (!out[id]) out[id] = { name: agentsMeta[id]?.name ?? id, alive: true }
    }
    return out
  }

  const getHintsForAgent = (agentId: string, upToIndex: number): string[] => {
    const texts: string[] = []
    for (let i = 0; i <= upToIndex && i < hintEntries.length; i++) {
      const entry = hintEntries[i].hints?.find((x) => x.agent_id === agentId)
      texts.push(entry?.text ?? "")
    }
    return texts
  }

  const baseAgents = buildAgentsFromVoteResult()

  for (let i = 0; i < hintEntries.length; i++) {
    const phase = hintEntries[i].phase ?? "hint_1"
    const agentsForStep: Record<string, MafiaAgentState & { name?: string }> = {}
    for (const aid of Object.keys(baseAgents)) {
      const base = baseAgents[aid]
      agentsForStep[aid] = {
        name: base.name,
        alive: base.alive ?? true,
      }
    }
    steps.push({
      phase,
      agents: agentsForStep,
      history: history.slice(0, i + 1),
    })
  }

  if (hintEntries.length > 0) {
    const lastHintAgents: Record<string, MafiaAgentState & { name?: string }> = {}
    for (const aid of Object.keys(baseAgents)) {
      lastHintAgents[aid] = { name: baseAgents[aid].name, alive: baseAgents[aid].alive ?? true }
    }
    steps.push({
      phase: "vote",
      agents: lastHintAgents,
      history: hintEntries.length ? history.slice(0, hintEntries.length) : [],
    })
  }

  if (voteResult) {
    const resultAgents: Record<string, MafiaAgentState & { name?: string }> = {}
    for (const a of voteResult.agents ?? []) {
      resultAgents[a.agent_id] = {
        name: agentsMeta[a.agent_id]?.name ?? a.agent_id,
        role: a.role,
        secret_word: a.secret_word,
        alive: voteResult.eliminated_id !== a.agent_id,
      }
    }
    for (const id of agentIds) {
      if (!resultAgents[id]) resultAgents[id] = { name: agentsMeta[id]?.name ?? id, alive: true }
    }
    steps.push({
      phase: "result",
      citizen_word: voteResult.citizen_word ?? undefined,
      wolf_word: voteResult.wolf_word ?? undefined,
      agents: resultAgents,
      history,
      eliminated_id: voteResult.eliminated_id,
      eliminated_role: voteResult.eliminated_role,
      winner: voteResult.winner,
      vote_detail: voteResult.vote_detail,
    })
  }

  return steps
}

/** mafia_state.history → 터미널 로그용 MafiaLogEntry[] */
export function mapMafiaHistoryToLogs(
  history: MafiaHistoryEntry[] | undefined,
  agentsMeta: Record<string, { name: string }>
): MafiaLogEntry[] {
  if (!history?.length) return []
  const entries: MafiaLogEntry[] = []
  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  for (const h of history) {
    if (h.phase?.startsWith("hint_") && h.hints) {
      for (const x of h.hints) {
        const name = x.name ?? agentsMeta[x.agent_id]?.name ?? x.agent_id
        entries.push({ round: 1, timestamp: ts(), text: `${name} hints: "${x.text || ""}"`, type: "HINT" })
      }
    }
    if (h.phase === "vote_result") {
      const eliminatedName = h.agents?.find((a) => a.agent_id === h.eliminated_id)
      const name = agentsMeta[h.eliminated_id ?? ""]?.name ?? (eliminatedName as { agent_id: string })?.agent_id ?? h.eliminated_id
      entries.push({ round: 1, timestamp: ts(), text: `${name} is eliminated!`, type: "REVEAL" })
      entries.push({
        round: 1,
        timestamp: ts(),
        text: `${name} was ${h.eliminated_role === "WOLF" ? "WOLF" : "CITIZEN"}!`,
        type: h.winner === "CITIZEN" ? "SHEEP_WIN" : "WOLF_WIN",
      })
    }
  }
  return entries
}
