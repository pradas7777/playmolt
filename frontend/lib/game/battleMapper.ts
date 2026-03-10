/**
 * 배틀 게임 상태 매핑: API/WebSocket → UI (AgentCard, RoundLog, TerminalLog 등).
 */

import type { BattleState, BattleAgentState } from "@/lib/api/games"
import type { RoundEvent } from "@/components/battle/round-log-panel"
import type { BattleLogEntry } from "@/components/battle/battle-terminal-log"
import { hashString, shuffleWithSeed } from "@/lib/utils"

const GAS_START_ROUND = 8
const MAX_ROUNDS = 15
const DEFAULT_AVATAR = "/images/cards/battle_game_prop.jpg"

/** Battle 게임 prop 이미지 4장 (랜덤 배정, 중복 없음) */
const BATTLE_PROPS = [
  "/images/cards/battle_prop_1.png",
  "/images/cards/battle_prop_2.png",
  "/images/cards/battle_prop_3.png",
  "/images/cards/battle_prop_4.png",
]

export interface MappedAgentState {
  id: string
  name: string
  hp: number
  energy: number
  lastAction: string
  isActive: boolean
  isDead: boolean
  characterImage: string
}

export interface MappedBattleUI {
  round: number
  maxRound: number
  phase: string
  agents: MappedAgentState[]
  gasActive: boolean
  activeAgentName: string
  /** 턴 순서 표시용 (action_order 그대로) */
  actionOrder: string[]
}

/**
 * battle_state → UI agents + round + phase + gasActive.
 * action_order[0] in collect phase = current turn.
 */
export function mapBattleStateToUI(bs: BattleState | undefined): MappedBattleUI {
  if (!bs) {
    return {
      round: 0,
      maxRound: MAX_ROUNDS,
      phase: "waiting",
      agents: [],
      gasActive: false,
      activeAgentName: "",
      actionOrder: [],
    }
  }
  const agentsMap = bs.agents ?? {}
  const actionOrder = bs.action_order ?? []
  const phase = bs.phase ?? "waiting"
  const round = bs.round ?? 0

  const currentTurnId =
    phase === "collect" && actionOrder.length > 0 ? actionOrder[0] : null

  const agentIds = Object.keys(agentsMap).sort()
  const seed = hashString(agentIds.join(","))
  const shuffledProps = shuffleWithSeed(BATTLE_PROPS, seed)
  const imageByIndex = Object.fromEntries(
    agentIds.map((id, i) => [id, shuffledProps[i % shuffledProps.length] ?? DEFAULT_AVATAR])
  )

  const agents: MappedAgentState[] = Object.entries(agentsMap).map(([id, s]) => {
    const name = (s as BattleAgentState & { name?: string }).name ?? id
    const alive = (s as BattleAgentState).alive ?? true
    return {
      id,
      name,
      hp: Math.min(4, Math.max(0, (s as BattleAgentState).hp ?? 0)),
      energy: Math.min(3, Math.max(0, (s as BattleAgentState).energy ?? 0)),
      lastAction: "",
      isActive: currentTurnId === id,
      isDead: !alive,
      characterImage: imageByIndex[id] ?? DEFAULT_AVATAR,
    }
  })

  // Keep stable order: action_order first, then rest
  const orderSet = new Set(actionOrder)
  const ordered = [...agents]
  ordered.sort((a, b) => {
    const ai = actionOrder.indexOf(a.id)
    const bi = actionOrder.indexOf(b.id)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return 0
  })

  const activeAgent = ordered.find((a) => a.id === currentTurnId)
  return {
    round,
    maxRound: MAX_ROUNDS,
    phase: phase.toUpperCase(),
    agents: ordered,
    gasActive: round >= GAS_START_ROUND,
    activeAgentName: activeAgent?.name ?? ordered[0]?.name ?? "",
    actionOrder: [...actionOrder],
  }
}

function logTimestamp(): string {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * round_log → RoundEvent[] (하단 배틀 로그와 동일 양식: round, timestamp, type, text).
 * roundForLog: 이 로그가 속한 라운드 번호 (방금 끝난 라운드).
 */
export function mapRoundLogToRoundEvents(
  roundLog: unknown[] | undefined,
  agents: MappedAgentState[],
  roundForLog: number
): RoundEvent[] {
  if (!roundLog?.length) return []
  const nameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const ts = logTimestamp()
  return roundLog.map((entry: unknown, i) => {
    const e = entry as { type?: string; agent_id?: string; target_id?: string; hp_after?: number }
    const id = `log-${Date.now()}-${i}`
    if ((e.type === "attack_hit" || e.type === "attack_blocked" || e.type === "attack_invalid") && e.agent_id && e.target_id) {
      const blocked = e.type === "attack_blocked"
      const invalid = e.type === "attack_invalid"
      const suffix = invalid ? "(이미 사망)" : blocked ? "(방어)" : ""
      return {
        id,
        round: roundForLog,
        timestamp: ts,
        text: `${nameById[e.agent_id] ?? e.agent_id} → ${nameById[e.target_id] ?? e.target_id} ${suffix}`.trim(),
        type: "ATTACK" as const,
      }
    }
    if (e.type === "defend" && e.agent_id) {
      return {
        id,
        round: roundForLog,
        timestamp: ts,
        text: `${nameById[e.agent_id] ?? e.agent_id} 방어`,
        type: "DEFEND" as const,
      }
    }
    if (e.type === "charge" && e.agent_id) {
      return {
        id,
        round: roundForLog,
        timestamp: ts,
        text: `${nameById[e.agent_id] ?? e.agent_id} 충전`,
        type: "CHARGE" as const,
      }
    }
    if (e.type === "death" && e.agent_id) {
      return {
        id,
        round: roundForLog,
        timestamp: ts,
        text: `${nameById[e.agent_id] ?? e.agent_id} 탈락`,
        type: "DEATH" as const,
      }
    }
    if (e.type === "gas_random" || e.type === "gas_all") {
      return {
        id,
        round: roundForLog,
        timestamp: ts,
        text: "가스 구역 발동",
        type: "GAS" as const,
      }
    }
    return {
      id,
      round: roundForLog,
      timestamp: ts,
      text: JSON.stringify(e),
      type: "ATTACK" as const,
    }
  })
}

/**
 * Build terminal log entry from state_update / round_end.
 */
export function stateUpdateToLogEntries(
  round: number,
  battleState: BattleState | undefined,
  eventType: "state_update" | "round_end"
): BattleLogEntry[] {
  const ts = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  if (eventType === "round_end") {
    return [
      {
        round,
        timestamp: ts,
        text: `Round ${round} ended`,
        type: "ROUND_END",
      },
    ]
  }
  return []
}

/**
 * From game_end event → winner name and points.
 */
export function mapGameEndToResult(
  event: { winner_id: string | null; results?: { agent_id: string; points: number; rank: number }[] },
  agentNames: Record<string, string>
): { winnerName: string; winnerPoints: number } {
  const winnerId = event.winner_id
  const results = event.results ?? []
  const winnerResult = results.find((r) => r.agent_id === winnerId)
  const points = winnerResult?.points ?? 0
  const winnerName = winnerId ? agentNames[winnerId] ?? winnerId : "—"
  return { winnerName, winnerPoints: points }
}

/**
 * Apply last action text from round_log to agents (for lastAction display).
 */
export function applyLastActionFromLog(
  agents: MappedAgentState[],
  roundLog: unknown[] | undefined
): MappedAgentState[] {
  if (!roundLog?.length) return agents
  const nameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const lastByAgent: Record<string, string> = {}
  for (const entry of roundLog as { type?: string; agent_id?: string; target_id?: string }[]) {
    if (entry.type === "attack" && entry.agent_id && entry.target_id) {
      lastByAgent[entry.agent_id] = `Attacked ${nameById[entry.target_id] ?? entry.target_id}`
    }
    if (entry.type === "damage" && entry.target_id !== undefined) {
      lastByAgent[entry.target_id] = "Hit!"
    }
    if (entry.type === "defend" && entry.agent_id) {
      lastByAgent[entry.agent_id] = "Defended"
    }
    if (entry.type === "charge" && entry.agent_id) {
      lastByAgent[entry.agent_id] = "Charged"
    }
    if (entry.type === "death" && entry.agent_id) {
      lastByAgent[entry.agent_id] = "Eliminated"
    }
  }
  return agents.map((a) => ({
    ...a,
    lastAction: lastByAgent[a.id] ?? a.lastAction,
  }))
}
