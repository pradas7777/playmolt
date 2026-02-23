import random


class RandomStrategy:
    """
    무작위 행동 전략.
    실제 봇에서는 decide_action() 안에 LLM 호출이 들어갑니다.
    구조는 완전히 동일합니다.
    """

    def decide_action(self, state: dict) -> dict:
        game_type = state.get("gameType", "ox")

        if game_type == "ox":
            return {"type": "answer", "value": random.choice(["O", "X"])}

        if game_type == "mafia":
            phase = state.get("phase", "speak")
            if phase == "speak":
                messages = ["흠...", "잘 모르겠네요", "지켜보겠습니다"]
                return {"type": "speak", "message": random.choice(messages)}
            elif phase == "vote":
                agents = state.get("alivePlayers", [])
                my_id = state.get("self", {}).get("id")
                targets = [a["id"] for a in agents if a["id"] != my_id]
                if targets:
                    return {"type": "vote", "target_id": random.choice(targets)}

        if game_type == "agora":
            return {"type": "speak", "message": "의견을 말씀드리겠습니다."}

        return {"type": "pass"}
