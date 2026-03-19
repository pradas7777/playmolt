"""
배틀 게임 데모 봇 전략.
실제 OPENCLAW는 이 부분을 LLM 호출로 대체함.
"""
import random


class BattleStrategy:
    """
    스마트 룰 기반 전략:
    - HP 위험하면 방어
    - 기력 3 모이면 HP 낮은 적 공격
    - 기모으기 기 순서 고려 (내 순서 늦으면 방어 유리)
    """

    def decide_action(self, state: dict, persona: str = "전략적", memory: dict | None = None) -> dict:
        me = state["self"]
        others = [a for a in state["other_agents"] if a["alive"]]
        my_position = state.get("my_position", 0)  # 이번 라운드 내 순서 (0=첫번째)
        round_num = state.get("round", 1)
        last_round = state.get("last_round") or {}
        last_log = last_round.get("log") or []
        mem = memory or {}

        if not others:
            return {"type": "charge"}

        my_id = me.get("id")

        # --- 상대 성향 메모리 업데이트 (직전 로그 기반) ---
        opp = mem.setdefault("opp", {})  # id -> {aggr, defn, charges, last_target}
        for e in last_log:
            aid = e.get("agent_id")
            if not aid:
                continue
            s = opp.setdefault(aid, {"aggr": 0, "defn": 0, "charges": 0, "last_target": None})
            t = e.get("type")
            if t in ("attack_hit", "attack_blocked"):
                s["aggr"] += 2
                s["last_target"] = e.get("target_id")
            elif t == "defend":
                s["defn"] += 1
            elif t == "charge":
                s["charges"] += 1

        # --- 내 연속 방어 스트릭 추적 (3턴 연속 방어 금지) ---
        # 서버가 "연속 3번 방어 금지"를 강제하지 않는 경우를 대비해,
        # 봇 레벨에서 2연속 방어 후에는 다음 턴에 방어를 회피하고 충전/공격으로 전환한다.
        defended_last = any(e.get("type") == "defend" and e.get("agent_id") == my_id for e in last_log)
        if defended_last:
            mem["defend_streak"] = int(mem.get("defend_streak", 0)) + 1
        else:
            mem["defend_streak"] = 0
        defend_streak = int(mem.get("defend_streak", 0))

        # 타겟 반복 방지(한 명만 계속 패는 단순함 완화)
        recent_targets = mem.setdefault("recent_targets", [])
        if not isinstance(recent_targets, list):
            recent_targets = mem["recent_targets"] = []

        # 직전 라운드에서 나를 때린 타겟이 있으면 우선순위(복수) 상승
        attacker_ids = [
            e.get("agent_id")
            for e in last_log
            if e.get("type") in ("attack_hit", "attack_blocked") and e.get("target_id") == me.get("id")
        ]
        revenge_target = attacker_ids[-1] if attacker_ids else None

        # 페르소나에 따른 공격 성향
        persona = (persona or "").strip()
        aggressive = persona in ("도전적", "공격적")
        conservative = persona in ("보수적",)

        def dmg_if_attacks(enemy_energy: int) -> int:
            return 1 + max(0, min(3, int(enemy_energy or 0)))

        my_energy = int(me.get("energy", 0) or 0)
        my_hp = int(me.get("hp", 0) or 0)
        my_dmg = 1 + max(0, min(3, my_energy))

        killers = [o for o in others if dmg_if_attacks(o.get("energy", 0)) >= my_hp]
        killable = [o for o in others if my_dmg >= int(o.get("hp", 0) or 0)]

        def pick_target(candidates: list[dict]) -> dict:
            if not candidates:
                candidates = others
            if revenge_target and any(o["id"] == revenge_target for o in candidates):
                return next(o for o in candidates if o["id"] == revenge_target)

            # "한 명 체력 낮으면 다 같이 때리기" 완화:
            # - 너무 낮은 HP(특히 1)는 '견제'보다 '마무리'로만 몰리기 쉬우니 일부 패널티
            # - 최근에 내가 때린 타겟은 패널티
            # - 대신 나를 노리는 위협(aggr/last_target==me)은 여전히 우선
            def base_score(o: dict) -> int:
                s = opp.get(o["id"], {})
                aggr = int(s.get("aggr", 0))
                last_t = s.get("last_target")
                target_me = 1 if last_t == me.get("id") else 0
                hp = int(o.get("hp", 0) or 0)
                atk_cnt = int(o.get("attack_count", 0) or 0)

                score = target_me * 100 + aggr * 6 + atk_cnt * 3

                # 너무 쉬운 마무리만 반복하지 않게 약한 패널티(다수전일수록)
                if len(others) >= 3 and hp <= 1 and not target_me:
                    score -= 12 if not aggressive else 6

                # 최근 타겟 반복 패널티
                if o.get("id") in recent_targets[-2:]:
                    score -= 10

                # 에너지 높은 적(다음 턴 큰딜 가능) 견제
                score += int(o.get("energy", 0) or 0) * 2

                return score

            ranked = sorted(candidates, key=base_score, reverse=True)
            if not ranked:
                return random.choice(others)

            # 상위 후보 중에서 약간의 변칙 선택(현실 LLM 같은 다양성)
            k = 3 if len(ranked) >= 3 else len(ranked)
            topk = ranked[:k]
            # 확률: 1등 0.62 / 2등 0.26 / 3등 0.12 (공격적이면 더 1등 몰빵)
            if k == 1:
                return topk[0]
            if aggressive:
                weights = [0.75, 0.20, 0.05][:k]
            else:
                weights = [0.62, 0.26, 0.12][:k]
            r = random.random()
            cum = 0.0
            for o, w in zip(topk, weights):
                cum += w
                if r <= cum:
                    return o
            return topk[0]

        # HP 1 이하 → 방어 (연속 3번 제한 확인)
        if my_hp <= 1 and "defend" in state["allowed_actions"]:
            if defend_streak >= 2 and "charge" in state["allowed_actions"]:
                return {"type": "charge"}
            return {"type": "defend"}

        gas_info = state.get("gas_info", {})
        gas_status = gas_info.get("status")

        # 확정 킬 가능이면 우선 처치 (특히 가스 구간/종반)
        if killable and "attack" in state["allowed_actions"]:
            target = pick_target(killable)
            # 타겟 기억 업데이트
            recent_targets.append(target["id"])
            mem["recent_targets"] = recent_targets[-5:]
            return {"type": "attack", "target_id": target["id"]}

        # 기력 3이면 공격이 강함: 위협(킬러) 우선, 없으면 HP 낮은 적
        if my_energy == 3 and "attack" in state["allowed_actions"]:
            target = pick_target(killers or others)
            recent_targets.append(target["id"])
            mem["recent_targets"] = recent_targets[-5:]
            return {"type": "attack", "target_id": target["id"]}

        # 내 순서가 늦을수록 (3, 4번째) 방어가 유리
        # 앞 순서 에이전트가 나를 공격할 수 있으니
        if my_position >= 2 and my_hp <= 2 and "defend" in state["allowed_actions"] and not aggressive:
            if defend_streak >= 2 and "charge" in state["allowed_actions"]:
                return {"type": "charge"}
            return {"type": "defend"}

        # 독가스 구간이면 빠르게 공격
        if gas_status in ("random_gas", "all_gas") and my_energy >= 1 and "attack" in state["allowed_actions"]:
            # 가스 구간은 공격 횟수(타이브레이크)도 중요 → 공격 카운트 높은 적을 견제
            if conservative and my_hp <= 2 and "defend" in state["allowed_actions"]:
                if defend_streak >= 2 and "charge" in state["allowed_actions"]:
                    return {"type": "charge"}
                return {"type": "defend"}
            target = pick_target(killers or others)
            # 타겟 기억 업데이트
            recent_targets.append(target["id"])
            mem["recent_targets"] = recent_targets[-5:]
            return {"type": "attack", "target_id": target["id"]}

        # 기력 2 이상이면 가끔 선제 공격(특히 도전적 페르소나)
        if my_energy >= 2 and "attack" in state["allowed_actions"] and aggressive:
            target = pick_target(killers or others)
            recent_targets.append(target["id"])
            mem["recent_targets"] = recent_targets[-5:]
            return {"type": "attack", "target_id": target["id"]}

        # 내가 낮은 HP인데 1방에 날릴 수 있는 적이 있으면 방어로 버팀(특히 비공격 페르소나)
        if killers and my_hp <= 2 and "defend" in state["allowed_actions"] and not aggressive:
            if defend_streak >= 2 and "charge" in state["allowed_actions"]:
                return {"type": "charge"}
            return {"type": "defend"}

        # 기본: 기모으기
        return {"type": "charge"}
