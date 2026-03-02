/**
 * Trial 게임: API/WS trial_state → UI 상태 매핑
 * 새 플로우: opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict
 */

import type {
  TrialState,
  TrialAgentState,
  TrialHistoryEntry,
} from "@/lib/api/games"
import type { TrialPhase } from "@/components/trial/case-info-panel"
import type { TrialAgent } from "@/components/trial/trial-card-layout"
import type { TrialLogEntry } from "@/components/trial/trial-terminal-log"

const DEFAULT_AVATAR = "/images/cards/trial_game_prop.jpg"

const BACKEND_ROLE_TO_UI: Record<string, TrialAgent["role"]> = {
  judge: "JUDGE",
  prosecutor: "PROSECUTOR",
  defense: "DEFENSE",
  juror_1: "JUROR_1",
  juror_2: "JUROR_2",
  juror_3: "JUROR_3",
}

/** 백엔드 phase → 프론트 TrialPhase (새 플로우) */
export function mapTrialPhase(phase: string): TrialPhase {
  switch (phase) {
    case "opening":
      return "OPENING"
    case "argument_1":
      return "ARGUMENT_1"
    case "jury_interim":
      return "JURY_INTERIM"
    case "judge_expand":
      return "JUDGE_EXPAND"
    case "argument_2":
      return "ARGUMENT_2"
    case "jury_final":
      return "JURY_FINAL"
    case "verdict":
      return "VERDICT"
    default:
      return "OPENING"
  }
}

/** trial_state.agents → TrialAgent[] (6인: JUDGE, PROSECUTOR, DEFENSE, JUROR_1~3) */
export function mapTrialAgentsToUI(
  ts: TrialState,
  agentsMeta?: Record<string, { name: string }>
): TrialAgent[] {
  const agents = ts.agents ?? {}
  const phase = ts.phase ?? "opening"
  const isVoteReveal =
    phase === "jury_final" || phase === "verdict"
  const verdict = (v: string | null | undefined): "GUILTY" | "NOT_GUILTY" | null => {
    if (v === "GUILTY" || v === "guilty") return "GUILTY"
    if (v === "NOT_GUILTY" || v === "not_guilty") return "NOT_GUILTY"
    return null
  }

  const entries = Object.entries(agents)
  let jurorIndex = 0
  const list = entries.map(([id, a]) => {
    const rawRole = (a.role ?? "").toLowerCase()
    let role = BACKEND_ROLE_TO_UI[rawRole]
    if (!role && (rawRole === "juror" || rawRole === "juror_1" || rawRole === "juror_2" || rawRole === "juror_3")) {
      const idx = jurorIndex++
      role = (["JUROR_1", "JUROR_2", "JUROR_3"] as const)[Math.min(idx, 2)]
    }
    if (!role) role = "JUROR_1"
    const name =
      (a as TrialAgentState & { name?: string }).name ??
      agentsMeta?.[id]?.name ??
      id
    return {
      id,
      name,
      characterImage: DEFAULT_AVATAR,
      role,
      statement: "",
      evidenceFor: [],
      evidenceAgainst: [],
      isSpeaking: false,
      vote: verdict(a.vote),
      voteRevealed: isVoteReveal && a.vote != null,
    }
  })
  return list
}

export interface MappedTrialUI {
  round: number
  maxRound: number
  phase: TrialPhase
  caseTitle: string
  caseDescription: string
  enrichedCase: TrialState["enriched_case"]
  expansion: TrialState["expansion"]
  agents: TrialAgent[]
  logs: TrialLogEntry[]
  verdict: string | null
  winnerTeam: string | null
  judgeComments: TrialState["judge_comments"]
  phaseStartedAt: number | null
}

/** trial_state → 관전/리플레이용 UI 상태 */
export function mapTrialStateToUI(
  ts: TrialState | undefined,
  agentsMeta?: Record<string, { name: string }>
): MappedTrialUI {
  if (!ts) {
    return {
      round: 1,
      maxRound: 10,
      phase: "OPENING",
      caseTitle: "",
      caseDescription: "",
      enrichedCase: undefined,
      expansion: undefined,
      agents: [],
      logs: [],
      verdict: null,
      winnerTeam: null,
      judgeComments: undefined,
      phaseStartedAt: null,
    }
  }
  const phase = mapTrialPhase(ts.phase ?? "opening")
  const agents = mapTrialAgentsToUI(ts, agentsMeta)
  const logs = mapTrialHistoryToLogs(ts.history, agentsMeta)
  const caseTitle =
    ts.case?.title ??
    ts.enriched_case?.enriched_title ??
    ""
  const caseDescription =
    ts.case?.description ??
    ts.enriched_case?.background ??
    ""

  return {
    round: 1,
    maxRound: 10,
    phase,
    caseTitle,
    caseDescription,
    enrichedCase: ts.enriched_case,
    expansion: ts.expansion,
    agents,
    logs,
    verdict: ts.verdict ?? null,
    winnerTeam: ts.winner_team ?? null,
    judgeComments: ts.judge_comments,
    phaseStartedAt: ts.phase_started_at ?? null,
  }
}

/** trial_state.history → 터미널 로그용 TrialLogEntry[] (새 플로우: phase + moves / votes) */
export function mapTrialHistoryToLogs(
  history: TrialHistoryEntry[] | undefined,
  agentsMeta: Record<string, { name: string }> = {}
): TrialLogEntry[] {
  if (!history?.length) return []
  const entries: TrialLogEntry[] = []
  const ts = () =>
    new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  for (const h of history) {
    const phaseLabel = (h.phase ?? "").replace(/_/g, " ")
    if (h.phase && !h.moves?.length && !h.votes?.length && !h.verdict) {
      entries.push({
        round: 1,
        timestamp: ts(),
        text: `Phase: ${phaseLabel}`,
        type: "PHASE_CHANGE",
      })
    }
    if (h.moves?.length) {
      for (const m of h.moves) {
        const name = agentsMeta[m.agent_id]?.name ?? m.agent_id
        const role = (m.role ?? "").toLowerCase()
        let type: TrialLogEntry["type"] = "JUROR"
        if (role === "prosecutor") type = "PROSECUTOR"
        else if (role === "defense") type = "DEFENSE"
        const claim = (m.claim ?? "").trim() || "(변론)"
        entries.push({
          round: 1,
          timestamp: ts(),
          text: `${name}: ${claim}`,
          type,
        })
      }
    }
    if (h.votes?.length) {
      for (const v of h.votes) {
        const name = agentsMeta[v.agent_id]?.name ?? v.agent_id
        const verdictText = v.verdict === "GUILTY" || v.verdict === "guilty" ? "GUILTY" : "NOT GUILTY"
        const reason = (v.reason ?? "").trim()
        const question = (v.question ?? "").trim()
        entries.push({
          round: 1,
          timestamp: ts(),
          text: `${name} votes: ${verdictText}${reason ? ` — ${reason}` : ""}${question ? ` | Q: ${question}` : ""}`,
          type: "JUROR",
        })
      }
    }
    if (h.question_summary) {
      entries.push({
        round: 1,
        timestamp: ts(),
        text: `Judge: ${h.question_summary}`,
        type: "INFO",
      })
    }
    if (h.verdict) {
      const isGuilty = h.verdict.toUpperCase() === "GUILTY"
      entries.push({
        round: 1,
        timestamp: ts(),
        text: `VERDICT: ${h.verdict.toUpperCase()}`,
        type: isGuilty ? "VERDICT_GUILTY" : "VERDICT_NOT_GUILTY",
      })
    }
  }
  return entries
}

/** 말풍선 1건 (통합 로그와 별개로 카드 위에서 순차 재생용) */
export interface TrialBubbleStep {
  agentId: string
  text: string
}

/**
 * history 마지막 항목에서 에이전트별 말풍선 순서 추출.
 * argument_1/argument_2 → moves(claim), jury_interim/jury_final → votes(reason/verdict), judge_expand → question_summary(판사).
 */
export function getBubbleSequenceFromHistory(
  history: TrialHistoryEntry[] | undefined,
  agents: TrialAgent[]
): TrialBubbleStep[] {
  if (!history?.length) return []
  const last = history[history.length - 1]
  const steps: TrialBubbleStep[] = []

  if (last.moves?.length) {
    for (const m of last.moves) {
      const text = (m.claim ?? "").trim() || "(변론)"
      steps.push({ agentId: m.agent_id, text })
    }
  }
  if (last.votes?.length) {
    for (const v of last.votes) {
      const verdictText = v.verdict === "GUILTY" || v.verdict === "guilty" ? "GUILTY" : "NOT GUILTY"
      const parts = [verdictText]
      if ((v.reason ?? "").trim()) parts.push((v.reason ?? "").trim())
      if ((v.question ?? "").trim()) parts.push(`Q: ${(v.question ?? "").trim()}`)
      steps.push({ agentId: v.agent_id, text: parts.join(" — ") })
    }
  }
  if (last.question_summary && last.phase === "judge_expand") {
    const judge = agents.find((a) => a.role === "JUDGE")
    if (judge) {
      steps.push({
        agentId: judge.id,
        text: (last.question_summary as string) || "(판사 질문 요약)",
      })
    }
  }
  return steps
}

/** 큐에서 해당 state 재생 시 대기할 말풍선 개수(지연 계산용) */
export function getBubbleCountFromState(ts: TrialState | undefined): number {
  if (!ts?.history?.length) return 1
  const last = ts.history[ts.history.length - 1]
  if (last.moves?.length) return last.moves.length
  if (last.votes?.length) return last.votes.length
  if (last.question_summary && last.phase === "judge_expand") return 1
  return 1
}

const NEW_PHASE_ORDER = [
  "opening",
  "argument_1",
  "jury_interim",
  "judge_expand",
  "argument_2",
  "jury_final",
  "verdict",
] as const

/** 리플레이용: history + agents_meta → 적용할 TrialState 스텝 배열 (새 플로우) */
export function buildTrialReplaySteps(
  history: TrialHistoryEntry[],
  agentsMeta: Record<string, { name: string }>,
  baseState?: TrialState
): TrialState[] {
  const steps: TrialState[] = []
  const agentsFromMeta: Record<string, TrialAgentState & { name?: string }> = {}
  for (const id of Object.keys(agentsMeta)) {
    agentsFromMeta[id] = { name: agentsMeta[id].name }
  }
  const lastVerdict = history.filter((h) => h.verdict).pop()
  const finalAgents = lastVerdict?.agents ?? []
  for (const a of finalAgents) {
    if (agentsFromMeta[a.agent_id]) {
      (agentsFromMeta[a.agent_id] as TrialAgentState).role = a.role
      ;(agentsFromMeta[a.agent_id] as TrialAgentState & { name?: string }).name =
        agentsMeta[a.agent_id]?.name ?? a.agent_id
    }
  }
  const firstWithCase = history.find((h) => (h as TrialHistoryEntry & { case?: TrialState["case"] }).case)
  const casePayload = firstWithCase
    ? (firstWithCase as TrialHistoryEntry & { case?: TrialState["case"] }).case
    : baseState?.case
  const expansionPayload = history.find((h) => h.new_evidence_for || h.new_evidence_against)
    ? {
        question_summary: history.find((h) => h.question_summary)?.question_summary,
        added_fact: history.find((h) => h.added_fact)?.added_fact,
        new_evidence_for: history.find((h) => h.new_evidence_for)?.new_evidence_for ?? [],
        new_evidence_against: history.find((h) => h.new_evidence_against)?.new_evidence_against ?? [],
      }
    : baseState?.expansion

  for (let idx = 0; idx < NEW_PHASE_ORDER.length; idx++) {
    const phase = NEW_PHASE_ORDER[idx]
    const upToHistory = history.filter((h) => {
      const pi = NEW_PHASE_ORDER.indexOf(h.phase as (typeof NEW_PHASE_ORDER)[number])
      return pi >= 0 && pi <= idx
    })
    steps.push({
      phase,
      agents: JSON.parse(JSON.stringify(agentsFromMeta)),
      history: upToHistory,
      case: casePayload,
      expansion: idx >= NEW_PHASE_ORDER.indexOf("judge_expand") ? expansionPayload : undefined,
      verdict: idx === NEW_PHASE_ORDER.length - 1 && lastVerdict ? lastVerdict.verdict : undefined,
      winner_team: idx === NEW_PHASE_ORDER.length - 1 ? lastVerdict?.winner_team : undefined,
    })
  }
  return steps
}
