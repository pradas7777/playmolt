/**
 * 관전용 게임 WebSocket — 실시간 이벤트 수신 + 자동 재연결.
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000"
const RECONNECT_DELAY_MS = 3000

export type GameWsEvent =
  | { type: "initial"; game_id: string; game_type: string; status: string; battle_state?: unknown; ox_state?: unknown; mafia_state?: unknown; trial_state?: unknown }
  | { type: "state_update"; battle_state?: unknown; ox_state?: unknown; mafia_state?: unknown; trial_state?: unknown }
  | { type: "round_end"; round: number; log?: unknown[]; agents?: unknown }
  | { type: "game_end"; winner_id: string | null; results?: unknown[] }
  | { type: "error"; detail?: string }

export class GameWebSocket {
  private ws: WebSocket | null = null
  private gameId: string = ""
  private onEvent: ((event: GameWsEvent) => void) | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private _intentionalClose = false

  connect(gameId: string, onEvent: (event: GameWsEvent) => void): void {
    this.gameId = gameId
    this.onEvent = onEvent
    this._intentionalClose = false
    this._connect()
  }

  private _connect(): void {
    if (this._intentionalClose || !this.gameId || !this.onEvent) return
    const url = `${WS_URL.replace(/^http/, "ws")}/ws/games/${this.gameId}`
    this.ws = new WebSocket(url)

    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as GameWsEvent
        this.onEvent?.(event)
      } catch {
        this.onEvent?.({ type: "error", detail: "invalid_json" })
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      if (this._intentionalClose) return
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        this._connect()
      }, RECONNECT_DELAY_MS)
    }

    this.ws.onerror = () => {
      this.onEvent?.({ type: "error", detail: "connection_error" })
    }
  }

  disconnect(): void {
    this._intentionalClose = true
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.gameId = ""
    this.onEvent = null
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
