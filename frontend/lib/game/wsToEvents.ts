/**
 * WebSocket / API 응답 → EventQueue용 GameEvent[] 변환 + 리플레이 초기 상태.
 */

import type { GameEvent } from "./eventQueue"
import type { MappedAgentState } from "./battleMapper"
import { hashString, shuffleWithSeed } from "@/lib/utils"

const DEFAULT_AVATAR = "/images/cards/battle_game_prop.jpg"

const BATTLE_PROPS = [
  "/images/cards/battle_prop_1.png",
  "/images/cards/battle_prop_2.png",
  "/images/cards/battle_prop_3.png",
  "/images/cards/battle_prop_4.png",
]

type LogEntry = {
  type: string
  agent_id?: string
  target_id?: string
  damage?: number
  target_hp_after?: number
  hp_after?: number
}

/**
 * 백엔드 round_log 한 개를 GameEvent로 변환 (attack_hit, attack_blocked, defend, charge, death, gas_*)
 */
function logEntryToEvent(entry: LogEntry, round: number): GameEvent | null {
  const type = entry.type
  const actor = entry.agent_id
  if (type === "attack_hit" && actor && entry.target_id !== undefined) {
    return {
      type: "attack",
      actor_id: actor,
      payload: {
        target_id: entry.target_id,
        damage: entry.damage ?? 1,
        blocked: false,
      },
    }
  }
  if (type === "attack_blocked" && actor && entry.target_id !== undefined) {
    return {
      type: "attack",
      actor_id: actor,
      payload: { target_id: entry.target_id, blocked: true },
    }
  }
  if (type === "attack_invalid" && actor && entry.target_id !== undefined) {
    return {
      type: "attack",
      actor_id: actor,
      payload: { target_id: entry.target_id, blocked: false, damage: 0, invalidTarget: true },
    }
  }
  if (type === "defend" && actor) {
    return { type: "defend", actor_id: actor, payload: {} }
  }
  if (type === "charge" && actor) {
    return { type: "charge", actor_id: actor, payload: {} }
  }
  if (type === "death" && entry.agent_id) {
    return { type: "death", actor_id: entry.agent_id, payload: {} }
  }
  if (type === "gas_all" || type === "gas_random") {
    return { type: "gas", payload: entry.agent_id ? { agent_id: entry.agent_id } : {} }
  }
  return null
}

/**
 * state_update의 battle_state → 재생할 GameEvent[] (round_log 기반 + 마지막에 state_snapshot)
 */
export function battleStateToEvents(battle_state: {
  round?: number
  phase?: string
  round_log?: unknown[]
  agents?: unknown
}): GameEvent[] {
  const events: GameEvent[] = []
  const round = battle_state.round ?? 0
  const roundLog = (battle_state.round_log ?? []) as LogEntry[]
  for (const entry of roundLog) {
    const ev = logEntryToEvent(entry, round)
    if (ev) events.push(ev)
  }
  events.push({ type: "state_snapshot", payload: { battle_state } })
  // 실시간 관전: round_end를 같은 메시지에 넣어 state_snapshot보다 뒤에 재생되도록 보장 (WS 도착 순서 이슈 방지)
  if (round > 1) {
    events.push({ type: "round_end", payload: { round: round - 1 } })
  }
  return events
}

/**
 * round_end WS 이벤트 → GameEvent[]
 */
export function roundEndToEvents(round: number): GameEvent[] {
  return [{ type: "round_end", payload: { round } }]
}

/**
 * game_end WS 이벤트 → GameEvent
 */
export function gameEndToEvent(winner_id: string | null, results?: unknown[]): GameEvent {
  return { type: "game_end", payload: { winner_id, results } }
}

/**
 * getGameLogs() history → 리플레이용 GameEvent[] (history[].log 플랫하게 + round_end)
 * round_end는 해당 라운드 로그를 넣은 뒤에만 추가 (countdown 등 log 없는 항목에서 먼저 넣으면 1라운드가 2로 밀리는 버그 방지)
 */
export function historyToEvents(
  history: { round: number; log?: unknown[]; phase?: string }[]
): GameEvent[] {
  const events: GameEvent[] = []
  for (const h of history) {
    const round = h.round ?? 0
    const log = (h.log ?? []) as LogEntry[]
    for (const entry of log) {
      const ev = logEntryToEvent(entry, round)
      if (ev) events.push(ev)
    }
    if (log.length > 0 && round > 0) {
      events.push({ type: "round_end", payload: { round } })
    }
  }
  return events
}

/**
 * getGameLogs 응답으로 리플레이 초기 에이전트 목록 + 라운드 생성.
 * history[0]이 game_start면 그대로 사용, 아니면 agents_meta로 4명 생성.
 */
export function buildInitialStateFromReplay(
  history: { phase?: string; round?: number; agents?: Record<string, { hp?: number; energy?: number; alive?: boolean; order?: number }>; action_order?: string[] }[],
  agentsMeta: Record<string, { name: string }>
): { agents: MappedAgentState[]; round: number } {
  const first = history[0]
  const agentIds = Object.keys(agentsMeta)
  if (agentIds.length === 0) {
    return { agents: [], round: 1 }
  }
  const seed = hashString(agentIds.sort().join(","))
  const shuffledProps = shuffleWithSeed(BATTLE_PROPS, seed)
  const imageByIndex = Object.fromEntries(
    agentIds.map((id, i) => [id, shuffledProps[i % shuffledProps.length] ?? DEFAULT_AVATAR])
  )

  if (first?.phase === "game_start" && first.agents && first.action_order) {
    const order = first.action_order ?? agentIds
    const agents: MappedAgentState[] = order.map((id, i) => {
      const s = first.agents![id] ?? { hp: 4, energy: 0, alive: true, order: i }
      return {
        id,
        name: agentsMeta[id]?.name ?? id,
        hp: Math.min(4, Math.max(0, s.hp ?? 4)),
        energy: Math.min(3, Math.max(0, s.energy ?? 0)),
        lastAction: "",
        isActive: false,
        isDead: !(s.alive ?? true),
        characterImage: imageByIndex[id] ?? DEFAULT_AVATAR,
      }
    })
    return { agents, round: first.round ?? 1 }
  }
  const agents: MappedAgentState[] = agentIds.slice(0, 4).map((id, i) => ({
    id,
    name: agentsMeta[id]?.name ?? id,
    hp: 4,
    energy: 0,
    lastAction: "",
    isActive: i === 0,
    isDead: false,
    characterImage: imageByIndex[id] ?? DEFAULT_AVATAR,
  }))
  return { agents, round: 1 }
}
