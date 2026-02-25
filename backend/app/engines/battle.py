"""
engines/battle.py - 4인 서바이벌 배틀 엔진

핵심 패턴:
  bs = self._bs()       # deepcopy로 현재 상태 복사
  ... bs 수정 ...
  self._commit(bs)      # config 전체 교체로 SQLAlchemy에 감지시킴
"""
import copy
import logging
import random
import threading
import time
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.engines.base import BaseGameEngine
from app.models.game import Game, GameStatus
from app.models.agent import Agent

# get_state에서 lazy start 시 한 게임당 한 번만 _setup_agents 실행하도록
_setup_locks: dict[str, threading.Lock] = {}
_setup_locks_mutex = threading.Lock()
# process_action 직렬화: 동시에 4명이 액션 제출 시 최신 pending_actions를 읽고 한 명만 commit 하면 덮어쓰기 방지
_action_locks: dict[str, threading.Lock] = {}
_action_locks_mutex = threading.Lock()


def _get_setup_lock(game_id: str) -> threading.Lock:
    with _setup_locks_mutex:
        if game_id not in _setup_locks:
            _setup_locks[game_id] = threading.Lock()
        return _setup_locks[game_id]


_logger = logging.getLogger(__name__)


def _get_action_lock(game_id: str) -> threading.Lock:
    with _action_locks_mutex:
        if game_id not in _action_locks:
            _action_locks[game_id] = threading.Lock()
        return _action_locks[game_id]


class BattleEngine(BaseGameEngine):

    MAX_AGENTS = 4
    MAX_ROUNDS = 15
    # collect 단계에서 이 시간(초) 안에 액션 안 낸 생존자는 charge로 처리해 라운드 진행 (외부 에이전트 이탈 대비)
    COLLECT_TIMEOUT_SEC = 45
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
        flag_modified(self.game, "config")
        self.db.commit()

    def _commit(self, new_bs: dict):
        self.game.config = {**self.game.config, "battle_state": new_bs}
        flag_modified(self.game, "config")  # JSON 컬럼 변경 감지 (안 하면 commit 후에도 DB에 반영 안 됨)
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
        bs["collect_entered_at"] = time.time()
        self._commit(bs)

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        lock = _get_action_lock(self.game.id)
        with lock:
            # 동시 제출 시 최신 pending_actions를 읽기 위해 DB에서 다시 로드
            self.db.refresh(self.game)
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
                # 잘못된 액션도 charge로 기록해, 한 명의 bad request가 나머지 봇 진행을 막지 않도록 함
                bs["pending_actions"][agent.id] = {"type": "charge"}
            else:
                bs["pending_actions"][agent.id] = validated["action"]

            alive_agents = [aid for aid, s in bs["agents"].items() if s["alive"]]
            all_submitted = set(alive_agents) == set(bs["pending_actions"].keys())
            if not all_submitted:
                # collect 타임아웃: 미제출자는 default_action(charge)로 처리해 라운드 진행
                entered = bs.get("collect_entered_at") or 0
                if time.time() - entered >= self._collect_timeout_sec():
                    missing = [aid for aid in alive_agents if aid not in bs["pending_actions"]]
                    for aid in missing:
                        bs["pending_actions"][aid] = self.default_action(aid)
                    _logger.info("battle collect timeout game_id=%s round=%s 미제출 charge 처리 agent_ids=%s", self.game.id, bs.get("round"), missing)
                    all_submitted = True
            self._commit(bs)

            if all_submitted:
                self._apply_round()

            if not validated["success"]:
                return validated
        return {"success": True, "message": "행동이 접수되었습니다"}

    def _collect_timeout_sec(self) -> int:
        return (self.game.config or {}).get("phase_timeout_seconds", self.COLLECT_TIMEOUT_SEC)

    def default_action(self, agent_id: str) -> dict:
        return {"type": "charge"}

    def _maybe_apply_collect_timeout(self) -> bool:
        """collect 단계에서 타임아웃 시 미제출자에 default_action 주입 후 라운드 적용. 1명 이상 주입 시 True."""
        if self.game.status != GameStatus.running:
            return False
        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            bs = self._bs()
            if bs.get("phase") != "collect":
                return False
            alive_agents = [aid for aid, s in bs["agents"].items() if s["alive"]]
            if set(alive_agents) == set(bs.get("pending_actions", {}).keys()):
                return False
            entered = bs.get("collect_entered_at") or 0
            if time.time() - entered < self._collect_timeout_sec():
                return False
            missing = [aid for aid in alive_agents if aid not in bs["pending_actions"]]
            for aid in missing:
                bs["pending_actions"][aid] = self.default_action(aid)
            _logger.info("battle collect timeout(get_state) game_id=%s round=%s 미제출 charge 처리 agent_ids=%s", self.game.id, bs.get("round"), missing)
            self._commit(bs)
            self._apply_round()
            return len(missing) > 0

    def apply_phase_timeout(self) -> bool:
        return self._maybe_apply_collect_timeout()

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
            bs["collect_entered_at"] = time.time()
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
        # 다른 요청에서 commit한 라운드 진행 반영을 위해 항상 DB에서 최신 상태 로드
        self.db.refresh(self.game)
        bs = self.game.config.get("battle_state") or {}
        # collect 타임아웃: state만 폴링하는 봇이 있어도 미제출자 charge 처리 후 라운드 진행
        if self.game.status == GameStatus.running and bs.get("phase") == "collect":
            self._maybe_apply_collect_timeout()
            self.db.refresh(self.game)
            bs = self.game.config.get("battle_state") or {}
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        # 4명 찼는데 아직 대기 중이면(방 합치기 등으로 늦게 모인 경우) 여기서 게임 시작
        if self.game.status == GameStatus.waiting and len(participants) >= self.MAX_AGENTS:
            lock = _get_setup_lock(self.game.id)
            with lock:
                self.db.refresh(self.game)
                participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
                if len(participants) >= self.MAX_AGENTS and self.game.status == GameStatus.waiting:
                    self._start_game()
            bs = self.game.config.get("battle_state") or {}
        # 게임은 이미 running인데 phase가 아직 waiting이면(4명 참가 직후 누락 등) 여기서 시작 처리
        elif (
            self.game.status == GameStatus.running
            and bs.get("phase") == "waiting"
            and (not bs.get("agents") or not bs.get("action_order"))
        ):
            lock = _get_setup_lock(self.game.id)
            with lock:
                self.db.refresh(self.game)
                bs = self.game.config.get("battle_state") or {}
                if bs.get("phase") == "waiting" and (not bs.get("agents") or not bs.get("action_order")):
                    participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
                    if len(participants) >= self.MAX_AGENTS:
                        self._setup_agents()
                bs = self.game.config.get("battle_state") or {}

        ag = bs.get("agents", {}).get(agent.id, {})

        other_agents = []
        for aid, s in bs.get("agents", {}).items():
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

        action_order = bs.get("action_order", [])
        history = bs.get("history", [])
        round_num = bs.get("round", 0)
        phase = bs.get("phase", "waiting")

        # 에이전트가 아직 battle_state에 없으면(대기 중) isAlive 기본 True
        is_alive = ag.get("alive", True) if ag else True
        return {
            "gameStatus": self.game.status.value,
            "gameType": "battle",
            "round": round_num,
            "maxRounds": self.MAX_ROUNDS,
            "phase": phase,
            "action_order": action_order,
            "my_position": action_order.index(agent.id) if agent.id in action_order else -1,
            "self": {
                "id": agent.id, "name": agent.name,
                "hp": ag.get("hp", 0), "energy": ag.get("energy", 0),
                "defend_streak": ag.get("defend_streak", 0),
                "attack_count": ag.get("attack_count", 0),
                "isAlive": is_alive,
            },
            "other_agents": other_agents,
            "allowed_actions": allowed,
            "last_round": history[-1] if history else None,
            "gas_info": self._get_gas_info(round_num),
            "result": self._get_result(agent.id) if phase == "end" else None,
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
        # 생존 1명이면 그 에이전트가 승자. 전원 사망(가스 등) 시에는 calculate_results에서 정한 rank 1이 승자이므로 DB 결과 사용
        is_winner = (agent_id in alive and len(alive) == 1) or (p and getattr(p, "result", None) == "win")
        return {
            "isWinner": is_winner,
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

        # coin 규칙: 1위 60점, 그 외 0점
        results = [{"agent_id": winner_id, "rank": 1, "points": 60}]
        for rank, (aid, _) in enumerate(reversed(dead), start=2):
            results.append({"agent_id": aid, "rank": rank, "points": 0})
        return results
