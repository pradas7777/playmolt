/**
 * OX 실시간 관전: state_update를 큐에 넣고 phase별 지연 후 순차 적용.
 * 배틀의 EventQueue와 동일한 목적 — 스킵 없이 모든 단계 표시.
 */

import type { OXState } from "@/lib/api/games"

const REVEAL_AGENT_DELAY_MS = 550
const REVEAL_SCORE_PANEL_WAIT_MS = 600
const OVERLAY_DURATION_MS = 2500
const SWITCH_PHASE_DISPLAY_MS = 10000
const RESULT_OVERLAYS_MS = OVERLAY_DURATION_MS * 3

export type OXQueueItem =
  | { type: "ox_state"; ox_state: OXState; agentsMeta?: Record<string, { name: string }> }
  | { type: "game_end"; winner_id?: string | null; results?: { agent_id: string; rank: number }[] }

function getDelayMsForPhase(phase: string, agentCount: number): number {
  switch (phase) {
    case "first_choice":
    case "waiting":
      return 0
    case "reveal":
      return (
        Math.max(1, agentCount) * REVEAL_AGENT_DELAY_MS +
        REVEAL_SCORE_PANEL_WAIT_MS +
        OVERLAY_DURATION_MS
      )
    case "switch":
      return SWITCH_PHASE_DISPLAY_MS
    case "final_result":
      return RESULT_OVERLAYS_MS
    default:
      return 1500
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type OXEventQueueOptions = {
  onApplyState: (item: { ox_state: OXState; agentsMeta?: Record<string, { name: string }> }) => void
  onGameEnd: (item: { winner_id?: string | null; results?: { agent_id: string; rank: number }[] }) => void
  onQueueEmpty?: () => void
}

export class OXEventQueue {
  private queue: OXQueueItem[] = []
  private isProcessing = false
  private readonly onApplyState: OXEventQueueOptions["onApplyState"]
  private readonly onGameEnd: OXEventQueueOptions["onGameEnd"]
  private readonly onQueueEmpty: () => void

  constructor(options: OXEventQueueOptions) {
    this.onApplyState = options.onApplyState
    this.onGameEnd = options.onGameEnd
    this.onQueueEmpty = options.onQueueEmpty ?? (() => {})
  }

  enqueue(item: OXQueueItem): void {
    this.queue.push(item)
    if (!this.isProcessing) this.processNext()
  }

  enqueueAll(items: OXQueueItem[]): void {
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
        ox_state: item.ox_state,
        agentsMeta: item.agentsMeta,
      })
      const agentCount = Object.keys(item.ox_state.agents ?? {}).length || 5
      const waitMs = getDelayMsForPhase(item.ox_state.phase ?? "", agentCount)
      if (waitMs > 0) await delay(waitMs)
    } catch (e) {
      console.error("[OXEventQueue] process error", e)
    }
    setTimeout(() => {
      void this.processNext()
    }, 0)
  }

  clear(): void {
    this.queue = []
    this.isProcessing = false
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getIsProcessing(): boolean {
    return this.isProcessing
  }
}
