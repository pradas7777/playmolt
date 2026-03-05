/**
 * 배틀 이벤트 핸들러 — 이벤트별 애니메이션 + 상태 반영. Promise로 애니메이션 완료 시점 반환.
 */

import type { GameEvent } from "./eventQueue"
import type { MappedAgentState } from "./battleMapper"
import type { BattleLogEntry } from "@/components/battle/battle-terminal-log"
import type { RoundEvent } from "@/components/battle/round-log-panel"
import {
  triggerAttackAnimation,
  triggerDefendAnimation,
  triggerChargeAnimation,
  triggerDeathAnimation,
  triggerGasAnimation,
  triggerRoundTransitionAnimation,
} from "./animationHelpers"
import type { RefObject } from "react"
import type { AgentCardHandle } from "@/components/agent-card/agent-card"
import { mapBattleStateToUI, mapRoundLogToRoundEvents } from "./battleMapper"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type BattleEventContext = {
  cardRefs: RefObject<(AgentCardHandle | null)[]>
  getAgents: () => MappedAgentState[]
  setAgents: (updater: (prev: MappedAgentState[]) => MappedAgentState[]) => void
  setRound: (updater: (prev: number) => number) => void
  setTerminalLogs: (updater: (prev: BattleLogEntry[]) => BattleLogEntry[]) => void
  setRoundEvents: (updater: (prev: RoundEvent[]) => RoundEvent[]) => void
  setDefending: (updater: (prev: Set<number>) => Set<number>) => void
  setGasActive: (value: boolean) => void
  setGameOver: (value: boolean) => void
  setWinnerName: (value: string) => void
  setWinnerPoints: (value: number) => void
  getAgentNames: () => Record<string, string>
  getRound: () => number
  setActionOrder?: (order: string[]) => void
  setPhase?: (value: string) => void
  setCollectEnteredAt?: (value: number | null) => void
  /** 라운드 전환 시 전체 화면 이펙트 표시 후 3초 대기. Promise 반환 시 해당 시점까지 대기 */
  onRoundTransition?: (round: number) => void | Promise<void>
}

function toBattleLogEntry(
  round: number,
  text: string,
  type: BattleLogEntry["type"]
): BattleLogEntry {
  const timestamp = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  return { round, timestamp, text, type }
}

/** 현재 라운드만 표시: 라운드가 바뀌면 이전 로그 비우고 새 이벤트만 추가 */
function appendRoundEvent(
  prev: RoundEvent[],
  event: RoundEvent,
  currentRound: number
): RoundEvent[] {
  if (prev.length > 0 && prev[prev.length - 1].round !== currentRound) return [event]
  return [...prev, event]
}

export async function handleBattleEvent(
  event: GameEvent,
  ctx: BattleEventContext
): Promise<void> {
  const agents = ctx.getAgents()
  const agentNames = ctx.getAgentNames()
  const name = (id: string) => agentNames[id] ?? id

  const getIdx = (agentId: string) => agents.findIndex((a) => a.id === agentId)

  switch (event.type) {
    case "attack": {
      ctx.setAgents((prev) => prev.map((a) => ({ ...a, isActive: a.id === event.actor_id })))
      await delay(350)
      const fromIdx = getIdx(event.actor_id)
      const toIdx = getIdx(event.payload.target_id)
      if (fromIdx !== -1 && toIdx !== -1 && ctx.cardRefs.current) {
        const refs = ctx.cardRefs.current as (AgentCardHandle | null)[]
        await triggerAttackAnimation(
          { current: refs[fromIdx] ?? null },
          { current: refs[toIdx] ?? null }
        )
      } else {
        await delay(400)
      }
      ctx.setAgents((prev) =>
        prev.map((a) => {
          if (a.id !== event.payload.target_id) return a
          const dmg = event.payload.blocked ? 0 : event.payload.damage ?? 1
          const newHp = Math.max(0, a.hp - dmg)
          return {
            ...a,
            hp: newHp,
            isDead: newHp === 0,
          }
        })
      )
      ctx.setAgents((prev) =>
        prev.map((a) =>
          a.id === event.actor_id ? { ...a, energy: 0, lastAction: "ATTACK" } : a
        )
      )
      const attackSuffix = event.payload.invalidTarget ? "(이미 사망)" : event.payload.blocked ? "(방어)" : ""
      ctx.setTerminalLogs((prev) => [
        ...prev,
        toBattleLogEntry(ctx.getRound(), `${name(event.actor_id)} → ${name(event.payload.target_id)} ${attackSuffix}`.trim(), "ATTACK"),
      ])
      const r = ctx.getRound()
      const roundEventSuffix = event.payload.invalidTarget ? "(이미 사망)" : event.payload.blocked ? "(방어)" : "공격"
      ctx.setRoundEvents((prev) =>
        appendRoundEvent(
          prev,
          {
            id: `re-${Date.now()}-at`,
            round: r,
            timestamp: "",
            text: `${name(event.actor_id)} → ${name(event.payload.target_id)} ${roundEventSuffix}`.trim(),
            type: "ATTACK",
          },
          r
        )
      )
      break
    }

    case "defend": {
      ctx.setAgents((prev) => prev.map((a) => ({ ...a, isActive: a.id === event.actor_id })))
      await delay(350)
      await triggerDefendAnimation()
      const idx = getIdx(event.actor_id)
      if (idx !== -1) ctx.setDefending((prev) => new Set([...prev, idx]))
      ctx.setAgents((prev) =>
        prev.map((a) =>
          a.id === event.actor_id ? { ...a, lastAction: "DEFEND" } : a
        )
      )
      ctx.setTerminalLogs((prev) => [...prev, toBattleLogEntry(ctx.getRound(), `${name(event.actor_id)} 방어`, "DEFEND")])
      const rDef = ctx.getRound()
      ctx.setRoundEvents((prev) =>
        appendRoundEvent(
          prev,
          { id: `re-${Date.now()}-df`, round: rDef, timestamp: "", text: `${name(event.actor_id)} 방어`, type: "DEFEND" },
          rDef
        )
      )
      break
    }

    case "charge": {
      ctx.setAgents((prev) => prev.map((a) => ({ ...a, isActive: a.id === event.actor_id })))
      await delay(350)
      const idx = getIdx(event.actor_id)
      const nextChargeLevel =
        idx !== -1 ? Math.min(3, (agents[idx]?.energy ?? 0) + 1) : 1
      if (idx !== -1 && ctx.cardRefs.current) {
        const refs = ctx.cardRefs.current as (AgentCardHandle | null)[]
        await triggerChargeAnimation({ current: refs[idx] ?? null }, nextChargeLevel)
      } else {
        await triggerChargeAnimation(undefined, nextChargeLevel)
      }
      ctx.setAgents((prev) =>
        prev.map((a) =>
          a.id === event.actor_id
            ? { ...a, energy: Math.min(3, a.energy + 1), lastAction: "CHARGE" }
            : a
        )
      )
      ctx.setTerminalLogs((prev) => [...prev, toBattleLogEntry(ctx.getRound(), `${name(event.actor_id)} 차지`, "CHARGE")])
      const rCh = ctx.getRound()
      ctx.setRoundEvents((prev) =>
        appendRoundEvent(
          prev,
          { id: `re-${Date.now()}-ch`, round: rCh, timestamp: "", text: `${name(event.actor_id)} 차지`, type: "CHARGE" },
          rCh
        )
      )
      break
    }

    case "death": {
      const idx = getIdx(event.actor_id)
      if (idx !== -1 && ctx.cardRefs.current) {
        const refs = ctx.cardRefs.current as (AgentCardHandle | null)[]
        await triggerDeathAnimation({ current: refs[idx] ?? null })
      } else {
        await delay(500)
      }
      ctx.setAgents((prev) =>
        prev.map((a) =>
          a.id === event.actor_id ? { ...a, hp: 0, isDead: true, lastAction: "탈락" } : a
        )
      )
      ctx.setTerminalLogs((prev) => [...prev, toBattleLogEntry(ctx.getRound(), `${name(event.actor_id)} 탈락`, "DEATH")])
      const rDeath = ctx.getRound()
      ctx.setRoundEvents((prev) =>
        appendRoundEvent(
          prev,
          { id: `re-${Date.now()}-death`, round: rDeath, timestamp: "", text: `${name(event.actor_id)} 탈락`, type: "DEATH" },
          rDeath
        )
      )
      break
    }

    case "gas": {
      await triggerGasAnimation()
      ctx.setGasActive(true)
      ctx.setTerminalLogs((prev) => [...prev, toBattleLogEntry(ctx.getRound(), "가스 구역 발동", "GAS")])
      const rGas = ctx.getRound()
      ctx.setRoundEvents((prev) =>
        appendRoundEvent(
          prev,
          { id: `re-${Date.now()}-gas`, round: rGas, timestamp: "", text: "가스 구역 발동", type: "GAS" },
          rGas
        )
      )
      break
    }

    case "round_end": {
      await triggerRoundTransitionAnimation(event.payload)
      ctx.setRound(() => event.payload.round + 1)
      ctx.setAgents((prev) => prev.map((a) => ({ ...a, lastAction: "" })))
      ctx.setDefending(() => new Set())
      if (event.payload.round >= 8) ctx.setGasActive(true)
      // 라운드 종료 로그 1번만 추가 (중복 round_end 이벤트 방지)
      const roundNum = event.payload.round
      const roundEndText = `라운드 ${roundNum} 종료`
      ctx.setTerminalLogs((prev) => {
        const last = prev[prev.length - 1]
        if (last?.type === "ROUND_END" && last.text === roundEndText) return prev
        return [...prev, toBattleLogEntry(roundNum, roundEndText, "ROUND_END")]
      })
      break
    }

    case "game_end": {
      await delay(500)
      const winnerId = event.payload.winner_id
      const results = (event.payload.results ?? []) as { agent_id: string; points: number }[]
      const winnerResult = results.find((r) => r.agent_id === winnerId)
      ctx.setWinnerName(winnerId ? ctx.getAgentNames()[winnerId] ?? winnerId : "—")
      ctx.setWinnerPoints(winnerResult?.points ?? 0)
      ctx.setGameOver(true)
      break
    }

    case "state_snapshot": {
      const bs = event.payload.battle_state as Parameters<typeof mapBattleStateToUI>[0] & {
        round_log?: unknown[]
        action_order?: string[]
        collect_entered_at?: number
      }
      const prevRound = ctx.getRound()
      const ui = mapBattleStateToUI(bs)
      const names = ctx.getAgentNames()
      ctx.setRound(() => ui.round)
      if (ctx.setPhase) ctx.setPhase(ui.phase)
      ctx.setAgents(() =>
        ui.agents.map((a) => ({
          ...a,
          name: names[a.id] ?? a.name,
        }))
      )
      ctx.setGasActive(ui.gasActive)
      ctx.setDefending(() => new Set())
      if (bs.round_log?.length && ui.round <= prevRound) {
        const roundForLog = Math.max(1, ui.round - 1)
        ctx.setRoundEvents(() => mapRoundLogToRoundEvents(bs.round_log!, ui.agents, roundForLog))
      }
      const order = bs.action_order
      if (order && ctx.setActionOrder) ctx.setActionOrder(order)
      if (ctx.setCollectEnteredAt) {
        ctx.setCollectEnteredAt(ui.phase === "COLLECT" && bs.collect_entered_at != null ? bs.collect_entered_at : null)
      }
      if (ui.round > prevRound && ui.phase !== "end" && ctx.onRoundTransition) {
        const p = ctx.onRoundTransition(ui.round)
        await (p ?? Promise.resolve())
      }
      break
    }
  }
}

