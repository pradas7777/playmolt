"""
engines/battle.py - 4인 서바이벌 배틀 엔진

핵심 패턴:
  bs = self._bs()       # deepcopy로 현재 상태 복사
  ... bs 수정 ...
  self._commit(bs)      # config 전체 교체로 SQLAlchemy에 감지시킴
"""
import copy
import random
from sqlalchemy.orm import Session

from app.engines.base import BaseGameEngine
from app.models.game import Game, GameStatus
from app.models.agent import Agent


class BattleEngine(BaseGameEngine):

    MAX_AGENTS = 4
    MAX_ROUNDS = 15
    GAS_RANDOM_START = 8
    GAS_ALL_START = 11

    def __init__(self, game: Game, db: Session):
        super().__init__(game, db)
        if "battle_state" not in self.game.config:
            self._init_battle_state()

    def _init_battle_state(self):
        self.game.config = {
            **self.game.config,
            "battle_state": {
                "round": 0, "phase": "waiting", "agents": {},
                "action_order": [], "pending_actions": {},
                "round_log": [], "history": [],
            }
        }
        self.db.commit()

    def _commit(self, new_bs: dict):
        self.game.config = {**self.game.config, "battle_state": new_bs}
        self.db.commit()
        from app.core.connection_manager import manager
        manager.schedule_broadcast(
            self.game.id,
            {"type": "state_update", "battle_state": new_bs},
        )

    def _bs(self) -> dict:
        return copy.deepcopy(self.game.config["battle_state"])

    def _start_game(self):
        super()._start_game()
        self._setup_agents()

    def _setup_agents(self):
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        agent_ids = [p.agent_id for p in participants]
        random.shuffle(agent_ids)

        agents = {
            aid: {"hp": 4, "energy": 0, "defend_streak": 0,
                  "attack_count": 0, "alive": True, "order": i}
            for i, aid in enumerate(agent_ids)
        }

        bs = self._bs()
        bs["agents"] = agents
        bs["action_order"] = agent_ids
        bs["round"] = 1
        bs["phase"] = "collect"
        self._commit(bs)

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        bs = self._bs()
        agent_state = bs["agents"].get(agent.id)
        if not agent_state:
            return {"success": False, "error": "AGENT_NOT_IN_GAME"}
        if not agent_state["alive"]:
            return {"success": False, "error": "AGENT_DEAD"}
        if bs["phase"] != "collect":
            return {"success": False, "error": "NOT_COLLECTION_PHASE"}
        if agent.id in bs["pending_actions"]:
            return {"success": False, "error": "ALREADY_ACTED"}

        validated = self._validate_action(agent.id, action, agent_state, bs)
        if not validated["success"]:
            return validated

        bs["pending_actions"][agent.id] = validated["action"]
        alive_agents = [aid for aid, s in bs["agents"].items() if s["alive"]]
        all_submitted = set(alive_agents) == set(bs["pending_actions"].keys())
        self._commit(bs)

        if all_submitted:
            self._apply_round()

        return {"success": True, "message": "행동이 접수되었습니다"}

    def _validate_action(self, agent_id, action, agent_state, bs):
        action_type = action.get("type")
        if action_type not in ["attack", "defend", "charge"]:
            return {"success": True, "action": {"type": "charge"}}
        if action_type == "defend" and agent_state["defend_streak"] >= 3:
            return {"success": False, "error": "DEFEND_STREAK_LIMIT"}
        if action_type == "attack":
            target_id = action.get("target_id")
            if not target_id:
                return {"success": False, "error": "ATTACK_NEEDS_TARGET"}
            t = bs["agents"].get(target_id)
            if not t or not t["alive"]:
                return {"success": False, "error": "INVALID_TARGET"}
            return {"success": True, "action": {"type": "attack", "target_id": target_id}}
        return {"success": True, "action": {"type": action_type}}

    def _apply_round(self):
        bs = self._bs()
        bs["phase"] = "apply"

        order = [a for a in bs["action_order"] if bs["agents"][a]["alive"]]
        defenders = {aid for aid, act in bs["pending_actions"].items() if act["type"] == "defend"}

        for agent_id in order:
            ag = bs["agents"][agent_id]
            if not ag["alive"]:
                bs["round_log"].append({"agent_id": agent_id, "type": "skip", "reason": "dead_before_action"})
                continue

            action = bs["pending_actions"].get(agent_id, {"type": "charge"})

            if action["type"] == "charge":
                ag["energy"] = min(3, ag["energy"] + 1)
                ag["defend_streak"] = 0
                bs["round_log"].append({"agent_id": agent_id, "type": "charge", "energy_after": ag["energy"]})

            elif action["type"] == "defend":
                ag["defend_streak"] += 1
                bs["round_log"].append({"agent_id": agent_id, "type": "defend", "streak": ag["defend_streak"]})

            elif action["type"] == "attack":
                tid = action["target_id"]
                tg = bs["agents"].get(tid)
                ag["defend_streak"] = 0
                dmg = 1 + ag["energy"]
                ag["energy"] = 0
                ag["attack_count"] += 1

                if not tg or not tg["alive"]:
                    bs["round_log"].append({"agent_id": agent_id, "type": "attack_invalid", "target_id": tid})
                elif tid in defenders:
                    bs["round_log"].append({"agent_id": agent_id, "type": "attack_blocked", "target_id": tid, "damage": dmg})
                else:
                    tg["hp"] -= dmg
                    bs["round_log"].append({"agent_id": agent_id, "type": "attack_hit", "target_id": tid, "damage": dmg, "target_hp_after": tg["hp"]})

        bs = self._process_deaths(bs)
        bs = self._apply_gas(bs)
        bs["history"].append({"round": bs["round"], "log": bs["round_log"]})

        alive = [s for s in bs["agents"].values() if s["alive"]]
        game_over = len(alive) <= 1 or bs["round"] >= self.MAX_ROUNDS

        if game_over:
            bs["phase"] = "end"
            self._commit(bs)
            self.finish()
        else:
            bs["round"] += 1
            bs["pending_actions"] = {}
            bs["round_log"] = []
            bs["phase"] = "collect"
            alive_order = [a for a in bs["action_order"] if bs["agents"][a]["alive"]]
            if alive_order:
                bs["action_order"] = alive_order[1:] + [alive_order[0]]
            self._commit(bs)
            # 라운드 종료 이벤트 (방금 끝난 라운드 기준)
            from app.core.connection_manager import manager
            ended_round = bs["round"] - 1
            last_history = bs["history"][-1] if bs["history"] else {}
            manager.schedule_broadcast(
                self.game.id,
                {
                    "type": "round_end",
                    "round": ended_round,
                    "log": last_history.get("log", []),
                    "agents": bs["agents"],
                },
            )

    def _process_deaths(self, bs):
        dead = [(aid, s) for aid, s in bs["agents"].items() if s["alive"] and s["hp"] <= 0]
        if not dead:
            return bs
        if len(dead) == 1:
            bs["agents"][dead[0][0]]["alive"] = False
            bs["agents"][dead[0][0]]["hp"] = 0
            bs["round_log"].append({"type": "death", "agent_id": dead[0][0]})
        else:
            max_atk = max(s["attack_count"] for _, s in dead)
            survivors = [(aid, s) for aid, s in dead if s["attack_count"] == max_atk]
            survivor_id, _ = random.choice(survivors)
            for aid, _ in dead:
                if aid != survivor_id:
                    bs["agents"][aid]["alive"] = False
                    bs["agents"][aid]["hp"] = 0
                    bs["round_log"].append({"type": "death", "agent_id": aid, "reason": "simultaneous_defeat"})
            bs["agents"][survivor_id]["hp"] = 1
            bs["round_log"].append({"type": "simultaneous_survival", "agent_id": survivor_id,
                                    "reason": "random" if len(survivors) > 1 else "attack_count"})
        return bs

    def _apply_gas(self, bs):
        rnd = bs["round"]
        alive = [(aid, s) for aid, s in bs["agents"].items() if s["alive"]]
        if not alive:
            return bs
        if rnd >= self.GAS_ALL_START:
            for aid, _ in alive:
                bs["agents"][aid]["hp"] -= 1
                bs["round_log"].append({"type": "gas_all", "agent_id": aid, "hp_after": bs["agents"][aid]["hp"]})
            bs = self._process_deaths(bs)
        elif rnd >= self.GAS_RANDOM_START:
            victim_id, _ = random.choice(alive)
            bs["agents"][victim_id]["hp"] -= 1
            bs["round_log"].append({"type": "gas_random", "agent_id": victim_id, "hp_after": bs["agents"][victim_id]["hp"]})
            bs = self._process_deaths(bs)
        return bs

    def get_state(self, agent: Agent) -> dict:
        bs = self.game.config["battle_state"]
        ag = bs["agents"].get(agent.id, {})

        other_agents = []
        for aid, s in bs["agents"].items():
            if aid != agent.id:
                oa = self.db.query(Agent).filter_by(id=aid).first()
                other_agents.append({
                    "id": aid, "name": oa.name if oa else aid,
                    "hp": s["hp"], "energy": s["energy"],
                    "alive": s["alive"], "attack_count": s["attack_count"],
                })

        allowed = ["attack", "charge"]
        if ag.get("defend_streak", 0) < 3:
            allowed.append("defend")

        return {
            "gameStatus": self.game.status.value,
            "gameType": "battle",
            "round": bs["round"],
            "maxRounds": self.MAX_ROUNDS,
            "phase": bs["phase"],
            "action_order": bs["action_order"],
            "my_position": bs["action_order"].index(agent.id) if agent.id in bs["action_order"] else -1,
            "self": {
                "id": agent.id, "name": agent.name,
                "hp": ag.get("hp", 0), "energy": ag.get("energy", 0),
                "defend_streak": ag.get("defend_streak", 0),
                "attack_count": ag.get("attack_count", 0),
                "isAlive": ag.get("alive", False),
            },
            "other_agents": other_agents,
            "allowed_actions": allowed,
            "last_round": bs["history"][-1] if bs["history"] else None,
            "gas_info": self._get_gas_info(bs["round"]),
            "result": self._get_result(agent.id) if bs["phase"] == "end" else None,
        }

    def _get_gas_info(self, rnd):
        if rnd < self.GAS_RANDOM_START:
            return {"status": "safe", "rounds_until_gas": self.GAS_RANDOM_START - rnd}
        elif rnd < self.GAS_ALL_START:
            return {"status": "random_gas", "rounds_until_all_gas": self.GAS_ALL_START - rnd}
        return {"status": "all_gas"}

    def _get_result(self, agent_id):
        bs = self.game.config["battle_state"]
        ag = bs["agents"].get(agent_id, {})
        alive = [aid for aid, s in bs["agents"].items() if s["alive"]]
        from app.models.game import GameParticipant
        p = self.db.query(GameParticipant).filter_by(game_id=self.game.id, agent_id=agent_id).first()
        return {
            "isWinner": agent_id in alive and len(alive) == 1,
            "isAlive": ag.get("alive", False),
            "points": p.points_earned if p else 0,
        }

    def check_game_end(self) -> bool:
        bs = self.game.config["battle_state"]
        alive = [s for s in bs["agents"].values() if s["alive"]]
        return len(alive) <= 1 or bs["round"] >= self.MAX_ROUNDS

    def calculate_results(self) -> list[dict]:
        bs = self.game.config["battle_state"]
        alive = [(aid, s) for aid, s in bs["agents"].items() if s["alive"]]
        dead = [(aid, s) for aid, s in bs["agents"].items() if not s["alive"]]

        if len(alive) == 1:
            winner_id = alive[0][0]
        elif alive:
            max_atk = max(s["attack_count"] for _, s in alive)
            winner_id = random.choice([aid for aid, s in alive if s["attack_count"] == max_atk])
        else:
            max_atk = max(s["attack_count"] for s in bs["agents"].values())
            winner_id = random.choice([aid for aid, s in bs["agents"].items() if s["attack_count"] == max_atk])

        results = [{"agent_id": winner_id, "rank": 1, "points": 200}]
        for rank, (aid, _) in enumerate(reversed(dead), start=2):
            results.append({"agent_id": aid, "rank": rank, "points": max(0, 50 - (rank - 2) * 10)})
        return results
