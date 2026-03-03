/**
 * 마피아 게임: API/WS mafia_state → UI 상태 매핑
 * 5인, hint → suspect → final → vote → revote → result
 */

import type { MafiaState, MafiaAgentState, MafiaHistoryEntry } from "@/lib/api/games"
import type { MafiaPhase } from "@/components/mafia/mafia-round-info"
import type { MafiaAgent } from "@/components/mafia/mafia-card-grid"
import type { MafiaLogEntry } from "@/components/mafia/mafia-terminal-log"

const DEFAULT_AVATAR = "/images/cards/mafia_game_prop.jpg"

/** 백엔드 phase → 프론트 MafiaPhase */
export function mapMafiaPhase(phase: string): MafiaPhase {
  switch (phase) {
    case "hint":
      return "HINT"
    case "suspect":
      return "SUSPECT"
    case "final":
      return "FINAL"
    case "vote":
      return "VOTE"
    case "revote":
      return "REVOTE"
    case "result":
    case "end":
      return "REVEAL"
    case "waiting":
      return "WORD_ASSIGNED"
    default:
      return "WORD_ASSIGNED"
  }
}

/** history에서 에이전트별 힌트 (단일 라운드) */
function getHintsFromHistory(agentId: string, history: MafiaHistoryEntry[] | undefined): string[] {
  const hints: string[] = []
  if (!history) return hints
  for (const h of history) {
    if ((h.phase === "hint" || h.phase?.startsWith("hint_")) && h.hints) {
      const entry = h.hints.find((x) => x.agent_id === agentId)
      hints.push(entry?.text ?? "")
    }
  }
  return hints
}

/** vote_detail 또는 suspect에서 이 에이전트가 지목한 대상 id */
function getTargetId(agentId: string, voteDetail: MafiaState["vote_detail"], history: MafiaState["history"], phase: string, pendingActions: MafiaState["pending_actions"]): string | null {
  if (voteDetail) {
    const row = voteDetail.find((r) => r.voter_id === agentId)
    if (row?.target_id) return row.target_id
  }
  if (phase === "suspect" && pendingActions) {
    const act = pendingActions[agentId] as { target_id?: string } | undefined
    if (act?.target_id) return act.target_id
  }
  const lastSuspect = history?.slice().reverse().find((h) => h.phase === "suspect" && (h as { suspects?: { agent_id: string; target_id: string }[] }).suspects)
  const suspects = (lastSuspect as { suspects?: { agent_id: string; target_id: string }[] })?.suspects ?? []
  const s = suspects.find((x) => x.agent_id === agentId)
  return s?.target_id ?? null
}

/** hint phase: pending 또는 history에서 힌트 채우기 */
function getHintsWithPending(
  agentId: string,
  history: MafiaState["history"],
  phase: string,
  pendingActions: MafiaState["pending_actions"]
): string[] {
  const hints = getHintsFromHistory(agentId, history)
  if (phase === "hint" && pendingActions) {
    const act = pendingActions[agentId] as { text?: string } | undefined
    if (act?.text != null) return [act.text]
  }
  return hints.length > 0 ? hints : [""]
}

/** mafia_state.agents → MafiaAgent[] */
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
    const targetId = getTargetId(id, voteDetail, history, phase, pendingActions)
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
  phaseTimeoutSeconds: number
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
      maxRound: 5,
      phase: "WORD_ASSIGNED",
      agents: [],
      phaseStartedAt: null,
      phaseTimeoutSeconds: 60,
      citizenWord: null,
      wolfWord: null,
      eliminatedId: null,
      eliminatedRole: null,
      winner: null,
      voteDetail: [],
    }
  }
  const phase = mapMafiaPhase(ms.phase ?? "waiting")
  const roundMap: Record<string, number> = { HINT: 1, SUSPECT: 2, FINAL: 3, VOTE: 4, REVOTE: 4, REVEAL: 5 }
  const round = roundMap[phase] ?? 1
  const agents = mapMafiaAgentsToUI(ms, agentsMeta)
  const citizenWord = ms.common_word ?? ms.citizen_word ?? null
  const wolfWord = ms.odd_word ?? ms.wolf_word ?? null
  return {
    round,
    maxRound: 5,
    phase,
    agents,
    phaseStartedAt: ms.phase_started_at ?? null,
    phaseTimeoutSeconds: ms.phase_timeout_seconds ?? 60,
    citizenWord,
    wolfWord,
    eliminatedId: ms.eliminated_id ?? null,
    eliminatedRole: ms.eliminated_role ?? null,
    winner: ms.winner ?? null,
    voteDetail: ms.vote_detail ?? [],
  }
}

/** 리플레이용: history → MafiaState 스텝 배열 */
export function buildMafiaReplaySteps(
  history: MafiaHistoryEntry[],
  agentsMeta: Record<string, { name: string }>
): MafiaState[] {
  if (!history.length) return []
  const voteResult = history.find((h) => h.phase === "vote_result") as (MafiaHistoryEntry & {
    agents?: { agent_id: string; role?: string; secret_word?: string }[]
  }) | undefined
  const hintEntries = history.filter((h) => h.phase === "hint" || h.phase?.startsWith("hint_"))
  const suspectEntries = history.filter((h) => h.phase === "suspect")
  const finalEntries = history.filter((h) => h.phase === "final")

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

  const baseAgents = buildAgentsFromVoteResult()
  let histIdx = 0

  /** result 이전 단계에서는 모든 에이전트 alive (아직 탈락 없음) */
  const allAliveAgents = (): Record<string, MafiaAgentState & { name?: string }> => {
    const out: Record<string, MafiaAgentState & { name?: string }> = {}
    for (const aid of Object.keys(baseAgents)) {
      out[aid] = { name: baseAgents[aid].name, alive: true }
    }
    return out
  }

  for (const _ of hintEntries) {
    histIdx += 1
    steps.push({ phase: "hint", agents: allAliveAgents(), history: history.slice(0, histIdx) })
  }

  for (const _ of suspectEntries) {
    histIdx += 1
    steps.push({ phase: "suspect", agents: allAliveAgents(), history: history.slice(0, histIdx) })
  }

  for (const _ of finalEntries) {
    histIdx += 1
    steps.push({ phase: "final", agents: allAliveAgents(), history: history.slice(0, histIdx) })
  }

  if (hintEntries.length > 0 || suspectEntries.length > 0 || finalEntries.length > 0) {
    steps.push({ phase: "vote", agents: allAliveAgents(), history: history.filter((h) => h.phase !== "vote_result") })
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
      common_word: voteResult.common_word ?? voteResult.citizen_word ?? undefined,
      odd_word: voteResult.odd_word ?? voteResult.wolf_word ?? undefined,
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

/** 힌트 로그 수 (순차 노출용) */
export function getHintLogCountPerRound(history: MafiaHistoryEntry[] | undefined): number {
  if (!history?.length) return 0
  const firstHint = history.find((h) => h.phase === "hint" || h.phase?.startsWith("hint_"))
  return firstHint?.hints?.length ?? 0
}

/** mafia_state.history → 터미널 로그용 MafiaLogEntry[] */
export function mapMafiaHistoryToLogs(
  history: MafiaHistoryEntry[] | undefined,
  agentsMeta: Record<string, { name: string }>,
  agentIdsInOrder?: string[]
): MafiaLogEntry[] {
  if (!history?.length) return []
  const entries: MafiaLogEntry[] = []
  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  for (const h of history) {
    if ((h.phase === "hint" || h.phase?.startsWith("hint_")) && h.hints) {
      const ids = agentIdsInOrder?.length ? agentIdsInOrder : h.hints.map((x) => x.agent_id)
      for (const aid of ids) {
        const x = h.hints.find((e) => e.agent_id === aid)
        const name = x?.name ?? agentsMeta[aid]?.name ?? aid
        entries.push({
          round: 1,
          timestamp: ts(),
          text: `${name} hints: "${(x?.text ?? "").trim() || "(empty)"}"`,
          type: "HINT",
        })
      }
    }
    if (h.phase === "suspect" && (h as { suspects?: { agent_id: string; name?: string; target_id: string; target_name?: string; reason_code?: string }[] }).suspects) {
      const suspects = (h as { suspects: { agent_id: string; name?: string; target_id: string; target_name?: string; reason_code?: string }[] }).suspects
      for (const s of suspects) {
        const name = s.name ?? agentsMeta[s.agent_id]?.name ?? s.agent_id
        const targetName = s.target_name ?? agentsMeta[s.target_id]?.name ?? s.target_id
        entries.push({
          round: 2,
          timestamp: ts(),
          text: `${name} → ${targetName} (${s.reason_code ?? "ETC"})`,
          type: "VOTE",
        })
      }
    }
    if (h.phase === "final" && (h as { statements?: { agent_id: string; name?: string; text: string }[] }).statements) {
      const stmts = (h as { statements: { agent_id: string; name?: string; text: string }[] }).statements
      for (const s of stmts) {
        const name = s.name ?? agentsMeta[s.agent_id]?.name ?? s.agent_id
        entries.push({
          round: 3,
          timestamp: ts(),
          text: `${name} final: "${(s.text ?? "").slice(0, 60)}..."`,
          type: "INFO",
        })
      }
    }
    if (h.phase === "revote_start" && (h as { candidates?: string[] }).candidates) {
      const candidates = (h as { candidates: string[] }).candidates
      const names = candidates.map((cid) => agentsMeta[cid]?.name ?? cid).join(", ")
      entries.push({
        round: 4,
        timestamp: ts(),
        text: `동점! 재투표 대상: ${names}`,
        type: "INFO",
      })
    }
    if (h.phase === "vote_result") {
      const eliminatedName = h.agents?.find((a) => a.agent_id === h.eliminated_id)
      const name = agentsMeta[h.eliminated_id ?? ""]?.name ?? (eliminatedName as { agent_id: string })?.agent_id ?? h.eliminated_id
      entries.push({ round: 4, timestamp: ts(), text: `${name} is eliminated!`, type: "REVEAL" })
      entries.push({
        round: 4,
        timestamp: ts(),
        text: `${name} was ${h.eliminated_role === "WOLF" ? "WOLF" : "CITIZEN"}!`,
        type: h.winner === "CITIZEN" ? "SHEEP_WIN" : "WOLF_WIN",
      })
    }
  }
  return entries
}
