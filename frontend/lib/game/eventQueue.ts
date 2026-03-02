/**
 * 이벤트 큐 — 애니메이션 순차 재생 및 리플레이용.
 */

export type GameEvent =
  | { type: "attack"; actor_id: string; payload: { target_id: string; damage?: number; blocked?: boolean; invalidTarget?: boolean } }
  | { type: "defend"; actor_id: string; payload?: Record<string, unknown> }
  | { type: "charge"; actor_id: string; payload?: Record<string, unknown> }
  | { type: "death"; actor_id: string; payload?: Record<string, unknown> }
  | { type: "gas"; payload?: { agent_id?: string } }
  | { type: "round_end"; payload: { round: number } }
  | { type: "game_end"; payload: { winner_id: string | null; results?: unknown[] } }
  | { type: "state_snapshot"; payload: { battle_state: unknown } }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DEFAULT_EVENT_DELAY_MS = 1000

export type EventQueueOptions = {
  onEvent: (event: GameEvent) => Promise<void>
  onQueueEmpty?: () => void
  onAfterEvent?: () => void
  eventDelayMs?: number
}

export class EventQueue {
  private queue: GameEvent[] = []
  private isPlaying = false
  private speed = 1.0
  private readonly onEvent: (event: GameEvent) => Promise<void>
  private readonly onQueueEmpty: () => void
  private readonly onAfterEvent: () => void
  private readonly baseDelayMs: number

  constructor(options: EventQueueOptions) {
    this.onEvent = options.onEvent
    this.onQueueEmpty = options.onQueueEmpty ?? (() => {})
    this.onAfterEvent = options.onAfterEvent ?? (() => {})
    this.baseDelayMs = options.eventDelayMs ?? DEFAULT_EVENT_DELAY_MS
  }

  enqueue(event: GameEvent): void {
    this.queue.push(event)
    if (!this.isPlaying) this.playNext()
  }

  enqueueAll(events: GameEvent[]): void {
    this.queue.push(...events)
    if (!this.isPlaying) this.playNext()
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false
      this.onQueueEmpty()
      return
    }
    this.isPlaying = true
    const event = this.queue.shift()!
    try {
      await this.onEvent(event)
    } catch (e) {
      console.error("[EventQueue] onEvent error", e)
    }
    this.onAfterEvent()
    await delay(Math.max(0, Math.round(this.baseDelayMs / this.speed)))
    this.playNext()
  }

  pause(): void {
    this.isPlaying = false
  }

  resume(): void {
    if (!this.isPlaying) this.playNext()
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(5, speed))
  }

  getSpeed(): number {
    return this.speed
  }

  clear(): void {
    this.queue = []
    this.isPlaying = false
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getIsPlaying(): boolean {
    return this.isPlaying
  }
}
