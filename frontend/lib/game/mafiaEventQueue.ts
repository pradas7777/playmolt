/**
 * 마피아 실시간 관전: state_update를 큐에 넣고 phase별 지연 후 순차 적용.
 * 배틀/OX와 동일 — 힌트 라운드별 말풍선 순차 재생 시간 확보.
 */

import type { MafiaState } from "@/lib/api/games"

/** 각 phase별 대기 시간: 10초 후 순차 진행 */
const PHASE_DELAY_MS = 10_000

export type MafiaQueueItem =
  | { type: "mafia_state"; mafia_state: MafiaState; agentsMeta?: Record<string, { name: string }> }
  | { type: "game_end"; winner_id?: string | null; results?: { agent_id: string; rank: number }[] }

function getDelayMsForPhase(_phase: string, _agentCount: number): number {
  return PHASE_DELAY_MS
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type MafiaEventQueueOptions = {
  onApplyState: (item: { mafia_state: MafiaState; agentsMeta?: Record<string, { name: string }> }) => void
  onGameEnd?: (item: { winner_id?: string | null; results?: { agent_id: string; rank: number }[] }) => void
  onQueueEmpty?: () => void
}

export class MafiaEventQueue {
  private queue: MafiaQueueItem[] = []
  private isProcessing = false
  private readonly onApplyState: MafiaEventQueueOptions["onApplyState"]
  private readonly onGameEnd: NonNullable<MafiaEventQueueOptions["onGameEnd"]>
  private readonly onQueueEmpty: () => void

  constructor(options: MafiaEventQueueOptions) {
    this.onApplyState = options.onApplyState
    this.onGameEnd = options.onGameEnd ?? (() => {})
    this.onQueueEmpty = options.onQueueEmpty ?? (() => {})
  }

  enqueue(item: MafiaQueueItem): void {
    this.queue.push(item)
    if (!this.isProcessing) this.processNext()
  }

  enqueueAll(items: MafiaQueueItem[]): void {
    this.queue.push(...items)
    if (!this.isProcessing) this.processNext()
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false
      this.onQueueEmpty()
      return
    }
    this.isProcessing = true
    const item = this.queue.shift()!
    try {
      if (item.type === "game_end") {
        this.onGameEnd({
          winner_id: item.winner_id,
          results: item.results,
        })
        setTimeout(() => void this.processNext(), 0)
        return
      }
      this.onApplyState({
        mafia_state: item.mafia_state,
        agentsMeta: item.agentsMeta,
      })
      const agentCount = Object.keys(item.mafia_state.agents ?? {}).length
      const waitMs = getDelayMsForPhase(item.mafia_state.phase ?? "", agentCount)
      if (waitMs > 0) await delay(waitMs)
    } catch (e) {
      console.error("[MafiaEventQueue] process error", e)
    }
    setTimeout(() => {
      void this.processNext()
    }, 0)
  }

  clear(): void {
    this.queue = []
    this.isProcessing = false
  }
}
