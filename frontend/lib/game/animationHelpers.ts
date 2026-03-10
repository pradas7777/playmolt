/**
 * 애니메이션 Promise 헬퍼 — 애니메이션 완료 시 resolve.
 */

import type { RefObject } from "react"
import type { AgentCardHandle } from "@/components/agent-card/agent-card"

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 공격: 공격자 → 대상 카드 트리거. duration 후 resolve */
export function triggerAttackAnimation(
  attackerRef: RefObject<AgentCardHandle | null>,
  targetRef: RefObject<AgentCardHandle | null>,
  intensity = 1
): Promise<void> {
  return new Promise<void>((resolve) => {
    attackerRef.current?.triggerAttack(
      { current: targetRef.current } as RefObject<AgentCardHandle | null>,
      intensity
    )
    setTimeout(resolve, 1200)
  })
}

/** 방어: 해당 인덱스 방어 이펙트는 상위에서 표시. 짧은 대기만 */
export function triggerDefendAnimation(): Promise<void> {
  return delay(600)
}

/** 충전: 짧은 대기 */
export function triggerChargeAnimation(
  cardRef?: RefObject<AgentCardHandle | null>,
  level = 1
): Promise<void> {
  return new Promise<void>((resolve) => {
    cardRef?.current?.triggerCharge(level)
    setTimeout(resolve, 550)
  })
}

/** 사망: 카드 shake 후 페이드 등. shake 호출 후 대기 */
export function triggerDeathAnimation(
  cardRef: RefObject<AgentCardHandle | null>
): Promise<void> {
  return new Promise<void>((resolve) => {
    cardRef.current?.shake("default")
    setTimeout(resolve, 1200)
  })
}

/** 가스: 전체 화면 이펙트는 상위에서. 대기 */
export function triggerGasAnimation(): Promise<void> {
  return delay(1500)
}

/** 라운드 전환: 대기 */
export function triggerRoundTransitionAnimation(_payload: { round: number }): Promise<void> {
  return delay(1200)
}
