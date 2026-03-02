/**
 * Trial 실시간 관전: state_update를 큐에 넣고, 액션 하나하나 반드시 순차 재생.
 * 10초 카운트다운 후 큐를 채우고, 고정 간격으로 한 건씩 적용.
 */

import type { TrialState } from "@/lib/api/games"

/** 말풍선 1개당 표시 시간(ms). 에이전트별 순차 재생 후 다음 state로. */
const BUBBLE_DURATION_MS = 2800
const VERDICT_DELAY_MS = 5000

export type TrialQueueItem =
  | {
      type: "trial_state"
      trial_state: TrialState
      agentsMeta?: Record<string, { name: string }>
      /** 말풍선 개수만큼 대기 후 다음 아이템 처리 */
      bubbleCount?: number
    }
  | { type: "game_end"; winner_id?: string | null; results?: { agent_id: string; rank: number }[] }

function getDelayMsForItem(item: TrialQueueItem): number {
  if (item.type === "game_end") return 0
  const phase = item.trial_state?.phase ?? ""
  if (phase === "verdict") return VERDICT_DELAY_MS
  const count = Math.max(1, item.bubbleCount ?? 1)
  return count * BUBBLE_DURATION_MS
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type TrialEventQueueOptions = {
  onApplyState: (item: { trial_state: TrialState; agentsMeta?: Record<string, { name: string }> }) => void
  onGameEnd?: (item: { winner_id?: string | null; results?: { agent_id: string; rank: number }[] }) => void
  onQueueEmpty?: () => void
}

export class TrialEventQueue {
  private queue: TrialQueueItem[] = []
  private isProcessing = false
  private readonly onApplyState: TrialEventQueueOptions["onApplyState"]
  private readonly onGameEnd: NonNullable<TrialEventQueueOptions["onGameEnd"]>
  private readonly onQueueEmpty: () => void

  constructor(options: TrialEventQueueOptions) {
    this.onApplyState = options.onApplyState
    this.onGameEnd = options.onGameEnd ?? (() => {})
    this.onQueueEmpty = options.onQueueEmpty ?? (() => {})
  }

  enqueue(item: TrialQueueItem): void {
    this.queue.push(item)
    if (!this.isProcessing) this.processNext()
  }

  enqueueAll(items: TrialQueueItem[]): void {
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
        trial_state: item.trial_state,
        agentsMeta: item.agentsMeta,
      })
      const waitMs = getDelayMsForItem(item)
      if (waitMs > 0) await delay(waitMs)
    } catch (e) {
      console.error("[TrialEventQueue] process error", e)
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
