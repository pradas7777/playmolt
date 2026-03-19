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

    def decide_action(self, state: dict) -> dict:
        me = state["self"]
        others = [a for a in state["other_agents"] if a["alive"]]
        my_position = state.get("my_position", 0)  # 이번 라운드 내 순서 (0=첫번째)
        round_num = state.get("round", 1)

        if not others:
            return {"type": "charge"}

        # HP 1 이하 → 방어 (연속 3번 제한 확인)
        if me["hp"] <= 1 and "defend" in state["allowed_actions"]:
            return {"type": "defend"}

        # 기력 3이면 HP 낮은 적 공격
        if me["energy"] == 3:
            target = min(others, key=lambda a: a["hp"])
            return {"type": "attack", "target_id": target["id"]}

        # 내 순서가 늦을수록 (3, 4번째) 방어가 유리
        # 앞 순서 에이전트가 나를 공격할 수 있으니
        if my_position >= 2 and me["hp"] <= 2 and "defend" in state["allowed_actions"]:
            return {"type": "defend"}

        # 독가스 구간이면 빠르게 공격
        gas_info = state.get("gas_info", {})
        if gas_info.get("status") in ("random_gas", "all_gas") and me["energy"] >= 1:
            target = min(others, key=lambda a: a["hp"])
            return {"type": "attack", "target_id": target["id"]}

        # 기본: 기모으기
        return {"type": "charge"}
