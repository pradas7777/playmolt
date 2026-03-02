/**
 * OX 게임: API/WS ox_state → UI 상태 매핑
 */

import type { OXState, OXAgentState, OXHistoryEntry } from "@/lib/api/games"
import type { OXPhase } from "@/components/ox/round-info-panel"
import type { OXAgent } from "@/components/ox/ox-main-panel"
import type { OXLogEntry } from "@/components/ox/ox-terminal-log"

const DEFAULT_AVATAR = "/images/cards/ox_game_prop.jpg"

/** 백엔드 phase → 프론트 OXPhase */
export function mapOXPhase(phase: string): OXPhase {
  switch (phase) {
    case "first_choice":
      return "FIRST_CHOICE"
    case "reveal":
      return "REVEAL"
    case "switch":
      return "SWITCH_TIME"
    case "final_result":
      return "RESULT"
    case "waiting":
      return "QUESTION_OPEN"
    default:
      return "FIRST_CHOICE"
  }
}

/** ox_state.agents → OXAgent[] (표시 순서: O 먼저, 그다음 X, null 마지막) */
export function mapOXAgentsToUI(agents: Record<string, OXAgentState & { name?: string }>): OXAgent[] {
  const list = Object.entries(agents).map(([id, a]) => {
    const choice = a.final_choice ?? a.first_choice ?? null
    return {
      id,
      name: (a as OXAgentState & { name?: string }).name ?? id,
      characterImage: DEFAULT_AVATAR,
      choice: choice === "O" || choice === "X" ? choice : null,
      switchAvailable: a.switch_available ?? true,
      switched: a.switch_used ?? false,
      points: a.total_points ?? 0,
      persona: "",
    }
  })
  const o = list.filter((x) => x.choice === "O")
  const x = list.filter((x) => x.choice === "X")
  const rest = list.filter((x) => x.choice === null)
  return [...o, ...x, ...rest]
}

export interface MappedOXUI {
  round: number
  maxRound: number
  phase: OXPhase
  question: string
  agents: OXAgent[]
  phaseStartedAt: number | null
  scoreboard: { id: string; name: string; points: number }[]
}

/** ox_state → 관전/리플레이용 UI 상태 */
export function mapOXStateToUI(os: OXState | undefined): MappedOXUI {
  if (!os) {
    return {
      round: 0,
      maxRound: 5,
      phase: "QUESTION_OPEN",
      question: "",
      agents: [],
      phaseStartedAt: null,
      scoreboard: [],
    }
  }
  const agents = mapOXAgentsToUI((os.agents || {}) as Record<string, OXAgentState & { name?: string }>)
  const scoreboard = Object.entries(os.agents || {})
    .map(([id, a]) => ({
      id,
      name: (a as OXAgentState & { name?: string }).name ?? id,
      points: (a as OXAgentState).total_points ?? 0,
    }))
    .sort((a, b) => b.points - a.points)
  return {
    round: os.round ?? 0,
    maxRound: 5,
    phase: mapOXPhase(os.phase ?? "waiting"),
    question: os.question ?? "",
    agents,
    phaseStartedAt: os.phase_started_at ?? null,
    scoreboard,
  }
}

/** ox_state.history → 터미널 로그용 OXLogEntry[] (선택) */
export function mapOXHistoryToLogs(
  history: OXHistoryEntry[] | undefined,
  agentsMeta: Record<string, { name: string }>
): OXLogEntry[] {
  if (!history?.length) return []
  const entries: OXLogEntry[] = []
  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  for (const h of history) {
    const r = h.round ?? 0
    if (h.question) {
      entries.push({ round: r, timestamp: ts(), text: `질문: ${h.question}`, type: "PHASE" })
    }
    const dist = h.distribution
    if (dist != null) {
      const oCount = dist.O ?? 0
      const xCount = dist.X ?? 0
      const minor = h.minority
      const pts = h.points_awarded ?? 0
      if (minor != null && pts > 0) {
        entries.push({
          round: r,
          timestamp: ts(),
          text: `결과: O=${oCount}, X=${xCount}. ${minor} 소수 승! +${pts}pt`,
          type: "RESULT",
        })
      } else {
        entries.push({
          round: r,
          timestamp: ts(),
          text: `결과: O=${oCount}, X=${xCount}. 동수 무득점`,
          type: "RESULT",
        })
      }
    }
    const choices = h.choices ?? []
    for (const c of choices) {
      const name = agentsMeta[c.agent_id]?.name ?? c.agent_id
      const fc = c.final_choice ?? c.first_choice ?? "O"
      entries.push({
        round: r,
        timestamp: ts(),
        text: c.switch_used ? `${name} 선택 ${fc} (스위치 사용)` : `${name} 선택 ${fc}`,
        type: fc === "O" ? "CHOOSE_O" : "CHOOSE_X",
      })
    }
  }
  return entries
}

/** 리플레이용: history + agents_meta → 적용할 OXState 스텝 배열 (최초선택 → 스위치 모션 → 최종결과 순) */
export function buildOXReplaySteps(
  history: OXHistoryEntry[],
  agentsMeta: Record<string, { name: string }>
): OXState[] {
  if (!history.length) return []
  const agentIds = Object.keys(agentsMeta)
  const steps: OXState[] = []
  let cumulativeHistory: OXHistoryEntry[] = []
  const pointsByAgent: Record<string, number> = Object.fromEntries(agentIds.map((id) => [id, 0]))
  const switchUsedByAgent: Record<string, boolean> = Object.fromEntries(agentIds.map((id) => [id, false]))

  for (let i = 0; i < history.length; i++) {
    const h = history[i]
    const r = h.round ?? i + 1
    const question = h.question ?? ""
    const choices = h.choices ?? []

    // 1) 질문만 (first_choice 단계)
    const agentsForQuestion: Record<string, OXAgentState & { name?: string }> = {}
    for (const id of agentIds) {
      agentsForQuestion[id] = {
        name: agentsMeta[id]?.name ?? id,
        first_choice: null,
        final_choice: null,
        switch_used: false,
        switch_available: !switchUsedByAgent[id],
        total_points: pointsByAgent[id] ?? 0,
      }
    }
    steps.push({
      round: r,
      phase: "first_choice",
      question,
      agents: agentsForQuestion,
      history: [...cumulativeHistory],
    })

    // 2) 최초선택(reveal): first_choice만 반영, final_choice = first_choice
    const agentsForReveal: Record<string, OXAgentState & { name?: string }> = {}
    for (const c of choices) {
      const id = c.agent_id
      const fc = c.first_choice ?? "O"
      agentsForReveal[id] = {
        name: agentsMeta[id]?.name ?? id,
        first_choice: fc,
        final_choice: fc,
        switch_used: false,
        switch_available: !switchUsedByAgent[id],
        total_points: pointsByAgent[id] ?? 0,
      }
    }
    for (const id of agentIds) {
      if (!agentsForReveal[id]) {
        agentsForReveal[id] = {
          name: agentsMeta[id]?.name ?? id,
          first_choice: null,
          final_choice: null,
          switch_used: false,
          switch_available: !switchUsedByAgent[id],
          total_points: pointsByAgent[id] ?? 0,
        }
      }
    }
    steps.push({
      round: r,
      phase: "reveal",
      question,
      agents: agentsForReveal,
      history: [...cumulativeHistory],
    })

    // 3) 스위치 모션(switch): 동일 레이아웃, phase만 switch
    steps.push({
      round: r,
      phase: "switch",
      question,
      agents: JSON.parse(JSON.stringify(agentsForReveal)) as Record<string, OXAgentState & { name?: string }>,
      history: [...cumulativeHistory],
    })

    // 4) 최종결과(final_result): final_choice·점수 반영
    const minority = h.minority ?? null
    const pointsAwarded = h.points_awarded ?? 0
    for (const c of choices) {
      const id = c.agent_id
      const fc = c.final_choice ?? c.first_choice ?? "O"
      if (minority && fc === minority) {
        pointsByAgent[id] = (pointsByAgent[id] ?? 0) + pointsAwarded
      }
    }
    const agentsForResult: Record<string, OXAgentState & { name?: string }> = {}
    for (const c of choices) {
      const id = c.agent_id
      agentsForResult[id] = {
        name: agentsMeta[id]?.name ?? id,
        first_choice: c.first_choice ?? "O",
        final_choice: c.final_choice ?? c.first_choice ?? "O",
        switch_used: c.switch_used ?? false,
        switch_available: !switchUsedByAgent[id],
        total_points: pointsByAgent[id] ?? 0,
      }
    }
    for (const id of agentIds) {
      if (!agentsForResult[id]) {
        agentsForResult[id] = {
          name: agentsMeta[id]?.name ?? id,
          first_choice: null,
          final_choice: null,
          switch_used: false,
          switch_available: !switchUsedByAgent[id],
          total_points: pointsByAgent[id] ?? 0,
        }
      }
    }
    cumulativeHistory = [...cumulativeHistory, h]
    steps.push({
      round: r,
      phase: "final_result",
      question,
      agents: agentsForResult,
      history: cumulativeHistory,
    })
    for (const c of choices) {
      if (c.switch_used) switchUsedByAgent[c.agent_id] = true
    }
  }
  return steps
}
