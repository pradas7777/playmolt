# 배틀 관전 페이지 전체 점검 결과

## 1. 라운드 애니메이션 순서

| 항목 | 요구 | 구현 | 상태 |
|------|------|------|------|
| 가스 | 가스 애니 → 체력 감소 | `gasEntries` 먼저, `showGasFog()` 후 `displayAgents[].hp = hp_after`, `updateRobots()` | ✅ |
| 봇 행동 순서 | 1라운드 [1,2,3,4], 2라 [2,3,4,1]… 회전 | `base_action_order` 저장, `rotateBy = (round-1) % 4`, `roundOrder`로 정렬 | ✅ |
| 공격 | 총(카드 밖) → 타겟 방향 → 레이저 | `attacker-slot` + `.robot-gun`(슬롯 직속, z-index 30), `getSlotCenter` 각도, `showLaser()` | ✅ |
| 공격받는 쪽 | 방어면 방어 이미지, 아니면 맞는 연출 | `attack_blocked` → blocking + defend-flash, `attack_hit` → hit-flash | ✅ |
| 방어 | 건너뛰기 | `entry.type === "defend"` 시 분기만 하고 아무 연출 없음 | ✅ |
| 충전 | 충전 이펙트 → 1.2초 후 해당 봇 에너지 1칸 | charge-glow/charge-flash, `setTimeout(1200)` 후 `displayAgents[id].energy` 갱신 + `updateRobots()` | ✅ |
| 사망 순서 | 공격 → 체력 감소 → 그 다음 사망 | `restWithIdx.sort`에서 `type === "death"` 항목을 항상 뒤로 정렬 | ✅ |

## 2. 죽은 봇 유지

| 항목 | 요구 | 구현 | 상태 |
|------|------|------|------|
| round_end | 죽은 봇 유지 | `mergeAgents(battleState.agents, agentsAfter)`, 목록에 없으면 `alive: false`, `hp: 0` | ✅ |
| state_update | 덮어쓰지 않고 병합 | `battleState.agents = mergeAgents(...)`, `action_order`는 4명 유지 시 기존 유지 | ✅ |
| 애니 종료 시 | agents 덮어쓰지 않기 | `battleState.agents = mergeAgents(battleState.agents, agentsAfter)` (3곳) | ✅ |

## 3. 슬롯 위치 고정

| 항목 | 요구 | 구현 | 상태 |
|------|------|------|------|
| 한 번 정해진 자리 유지 | 죽어도 자리만 유지, 이름/서있음·쓰러짐 안 바뀜 | `fixed_slot_agent_ids`: 4명일 때 한 번만 설정, `updateRobots`는 항상 이걸로 배치 | ✅ |

## 4. 연출·UI

| 항목 | 요구 | 구현 | 상태 |
|------|------|------|------|
| 총 | 카드 밖에서 잘 보이게 | `.robot-gun` 슬롯 직속, bottom:42px, 크기·글로우 강화, z-index 30 | ✅ |
| 레이저 | 잘리지 않게 | `.arena-wrapper` overflow: visible | ✅ |
| 마지막 스텝 | 끊기지 않고 4초 유지 | `LAST_STEP_DELAY_MS = 4000`, 마지막 스텝 후 `clearInterval` 후 `setTimeout(..., 4000)` | ✅ |
| 왼쪽 위 | 라운드 + 페이즈(잘 보이게) | `arenaInfo`: 라운드 + `arena-info-phase`(밝은색, font-weight 600), 카운트초 포함 | ✅ |
| 카운트다운 | 서버 값 그대로(13/16초 등) | `getCountdownRemaining()`: endsAt > 1e12이면 /1000 해서 초 단위로 표시 | ✅ |
| 게임 로그 | 오른쪽 | `.game-screen-row` flex, 아레나 왼쪽 / 로그 오른쪽 (320px 등) | ✅ |

## 5. 라운드 시작 상태

| 항목 | 요구 | 구현 | 상태 |
|------|------|------|------|
| 연출 전 상태 | 로그 역산으로 라운드 시작 시점 | `agentsAtRoundStart(agentsAfter, log)`: charge/attack_hit/gas/death 역순 롤백 | ✅ |

## 6. 기타

| 항목 | 구현 | 상태 |
|------|------|------|
| clearEffects | attacker-slot, 카드 클래스, 배터리 클래스 제거 + hideLaser | ✅ |
| findSlotByAgent | `slot.dataset.agentId === agentId` (고정 슬롯 배치와 일치) | ✅ |
| initial | battle_state 그대로 적용, 새 게임이면 fixed_slot_agent_ids 없음 → 첫 4명일 때 설정 | ✅ |

---

## 요약

- **애니메이션 순서**: 가스 → 행동(회전 순서) → 사망은 항상 맨 뒤, 공격/방어/충전/사망 처리 일치.
- **죽은 봇**: round_end/state_update/애니 종료 시 모두 병합, 죽은 봇 제거되지 않음.
- **위치 고정**: `fixed_slot_agent_ids`로 4자리 한 번 고정, 죽어도 같은 자리에서 쓰러진 상태만 표시.
- **연출·UI**: 총(카드 밖), 레이저, 마지막 4초, 라운드/페이즈, 카운트다운, 로그 오른쪽 배치 모두 반영됨.

**추가 수정 제안**: 없음. 현재 스펙 기준으로 동작이 일치함.
