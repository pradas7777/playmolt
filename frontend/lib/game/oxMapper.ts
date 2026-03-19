/**
 * OX 게임: API/WS ox_state → UI 상태 매핑
 */

import type { OXState, OXAgentState, OXHistoryEntry } from "@/lib/api/games"
import type { OXPhase } from "@/components/ox/round-info-panel"
import type { OXAgent } from "@/components/ox/ox-main-panel"
import type { OXLogEntry } from "@/components/ox/ox-terminal-log"
import { hashString, shuffleWithSeed } from "@/lib/utils"

const DEFAULT_AVATAR = "/images/cards/ox_game_prop.jpg"

/** OX 게임 prop 이미지 5장 (랜덤 배정, 중복 없음) */
const OX_PROPS = [
  "/images/cards/ox_prop_1.png",
  "/images/cards/ox_prop_2.png",
  "/images/cards/ox_prop_3.png",
  "/images/cards/ox_prop_4.png",
  "/images/cards/ox_prop_5.png",
]

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
  const agentIds = Object.keys(agents).sort()
  const seed = hashString(agentIds.join(","))
  const shuffledProps = shuffleWithSeed(OX_PROPS, seed)
  const imageByIndex = Object.fromEntries(
    agentIds.map((id, i) => [id, shuffledProps[i % shuffledProps.length] ?? DEFAULT_AVATAR])
  )

  const list = Object.entries(agents).map(([id, a]) => {
    const choice = a.final_choice ?? a.first_choice ?? null
    return {
      id,
      name: (a as OXAgentState & { name?: string }).name ?? id,
      characterImage: imageByIndex[id] ?? DEFAULT_AVATAR,
      choice: choice === "O" || choice === "X" ? choice : null,
      switchAvailable: a.switch_available ?? true,
      /** 게임 전체에서 한 번이라도 스위치 사용 (기존) */
      switched: a.switch_used ?? false,
      /** 이번 턴(라운드)에서만 스위치 사용 — 로그/카드 표시용 */
      switchedThisRound: a.switched_this_round ?? false,
      comment: (a as OXAgentState & { comment?: string }).comment ?? "",
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

const logTimestamp = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/**
 * 리플레이용: 현재 스텝이 first_choice/reveal/switch일 때 step.history에 이번 라운드가 아직 없으므로,
 * 스텝 데이터(question, agents)로 이번 라운드 로그만 생성. final_result는 mapOXHistoryToLogs에서 처리.
 */
export function getLogEntriesForCurrentRoundFromStep(
  step: { round?: number; phase?: string; question?: string; agents?: Record<string, OXAgentState & { name?: string }> },
  agentsMeta: Record<string, { name: string }>
): OXLogEntry[] {
  const r = step.round ?? 1
  const entries: OXLogEntry[] = []
  if (step.question) {
    entries.push({ round: r, timestamp: logTimestamp(), text: `질문: ${step.question}`, type: "PHASE" })
  }
  if ((step.phase === "reveal" || step.phase === "switch") && step.agents) {
    const commentLines: OXLogEntry[] = []
    for (const [id, a] of Object.entries(step.agents)) {
      const choice = a.first_choice ?? a.final_choice ?? "O"
      const name = (a as OXAgentState & { name?: string }).name ?? agentsMeta[id]?.name ?? id
      entries.push({
        round: r,
        timestamp: logTimestamp(),
        text: `${name} 처음 선택 ${choice}`,
        type: choice === "O" ? "CHOOSE_O" : "CHOOSE_X",
      })
      const cmt = (a as OXAgentState & { comment?: string }).comment
      if (cmt && String(cmt).trim()) {
        commentLines.push({
          round: r,
          timestamp: logTimestamp(),
          text: `${name}: ${String(cmt).trim()}`,
          type: "INFO",
        })
      }
    }
    if (commentLines.length) {
      entries.push({ round: r, timestamp: logTimestamp(), text: "──────── 코멘트 ────────", type: "INFO" })
      entries.push(...commentLines)
    }
  }
  return entries
}

/** ox_state.history → 터미널 로그용 OXLogEntry[] (선택) */
export function mapOXHistoryToLogs(
  history: OXHistoryEntry[] | undefined,
  agentsMeta: Record<string, { name: string }>
): OXLogEntry[] {
  if (!history?.length) return []
  const entries: OXLogEntry[] = []
  for (const h of history) {
    const r = h.round ?? 0
    if (h.question) {
      entries.push({ round: r, timestamp: logTimestamp(), text: `질문: ${h.question}`, type: "PHASE" })
    }
    const dist = h.distribution
    let resultEntry: OXLogEntry | null = null
    if (dist != null) {
      const oCount = dist.O ?? 0
      const xCount = dist.X ?? 0
      const minor = h.minority
      const pts = h.points_awarded ?? 0
      if (minor != null && pts > 0) {
        resultEntry = {
          round: r,
          timestamp: logTimestamp(),
          text: `결과: O=${oCount}, X=${xCount}. ${minor} 소수 승! +${pts}pt`,
          type: "RESULT",
        }
      } else {
        resultEntry = {
          round: r,
          timestamp: logTimestamp(),
          text: `결과: O=${oCount}, X=${xCount}. 동수 무득점`,
          type: "RESULT",
        }
      }
    }
    const choices = h.choices ?? []

    const firstLogs: OXLogEntry[] = []
    const switchLogs: OXLogEntry[] = []
    const finalLogs: OXLogEntry[] = []
    const commentLogs: OXLogEntry[] = []

    for (const c of choices) {
      const name = agentsMeta[c.agent_id]?.name ?? c.agent_id
      const first = c.first_choice ?? "O"
      const final = c.final_choice ?? first
      const switched = !!c.switch_used && first !== final
      const cmt = (c as { comment?: string }).comment

      // 1) 처음 이동/선택 로그
      firstLogs.push({
        round: r,
        timestamp: logTimestamp(),
        text: `${name} 처음 선택 ${first}`,
        type: first === "O" ? "CHOOSE_O" : "CHOOSE_X",
      })
      if (cmt && String(cmt).trim()) {
        commentLogs.push({
          round: r,
          timestamp: logTimestamp(),
          text: `${name}: ${String(cmt).trim()}`,
          type: "INFO",
        })
      }

      // 2) 스위치 사용 여부 로그 (스위치한 경우에만)
      if (switched) {
        switchLogs.push({
          round: r,
          timestamp: logTimestamp(),
          text: `${name} 스위치 사용 (${first} → ${final})`,
          type: "SWITCH",
        })
      }

      // 3) 최종 이동/선택 로그
      finalLogs.push({
        round: r,
        timestamp: logTimestamp(),
        text: `${name} 최종 선택 ${final}${switched ? " (스위치 사용)" : ""}`,
        type: final === "O" ? "CHOOSE_O" : "CHOOSE_X",
      })
    }

    // 한 라운드 안에서: 처음 선택들 → 스위치들 → 최종 선택들 순서로 쌓이도록 병합
    if (firstLogs.length) {
      entries.push({
        round: r,
        timestamp: logTimestamp(),
        text: "──────── 처음 선택 ────────",
        type: "INFO",
      })
      entries.push(...firstLogs)
    }
    if (commentLogs.length) {
      entries.push({
        round: r,
        timestamp: logTimestamp(),
        text: "──────── 코멘트 ────────",
        type: "INFO",
      })
      entries.push(...commentLogs)
    }
    if (switchLogs.length) {
      entries.push({
        round: r,
        timestamp: logTimestamp(),
        text: "──────── 스위치 사용 ────────",
        type: "INFO",
      })
      entries.push(...switchLogs)
    }
    if (finalLogs.length) {
      entries.push({
        round: r,
        timestamp: logTimestamp(),
        text: "──────── 최종 선택 ────────",
        type: "INFO",
      })
      entries.push(...finalLogs)
    }
    if (resultEntry) entries.push(resultEntry)
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
        comment: "",
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
        comment: (c as { comment?: string }).comment ?? "",
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
          comment: "",
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
        switched_this_round: c.switch_used ?? false,
        switch_available: !switchUsedByAgent[id],
        total_points: pointsByAgent[id] ?? 0,
        comment: (c as { comment?: string }).comment ?? "",
      }
    }
    for (const id of agentIds) {
      if (!agentsForResult[id]) {
        agentsForResult[id] = {
          name: agentsMeta[id]?.name ?? id,
          first_choice: null,
          final_choice: null,
          switch_used: false,
          switched_this_round: false,
          switch_available: !switchUsedByAgent[id],
          total_points: pointsByAgent[id] ?? 0,
          comment: "",
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
