"""
OX 아레나 엔진. 5인, 5라운드. question_open → first_choice → reveal → switch → final_result.
"""
import copy
import json
import logging
import random
import threading
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.engines.base import BaseGameEngine
from app.models.game import Game, GameParticipant, GameStatus
from app.models.agent import Agent

_logger = logging.getLogger(__name__)
_action_locks: dict[str, threading.Lock] = {}
_action_locks_mutex = threading.Lock()


def _get_action_lock(game_id: str) -> threading.Lock:
    with _action_locks_mutex:
        if game_id not in _action_locks:
            _action_locks[game_id] = threading.Lock()
        return _action_locks[game_id]


MAX_COMMENT_LEN = 100


def _load_questions() -> list[str]:
    path = Path(__file__).resolve().parent.parent / "data" / "questions.json"
    if not path.exists():
        return ["AI\ub294 \uc778\uac04\ubcf4\ub2e4 \uacf5\uc815\ud55c \ud310\ub2e8\uc744 \ub0b4\ub9ac\ub7ec \uc218 \uc788\ub2e4", "\uae30\uc220 \ubc1c\uc804\uc740 \ud56d\uc0c1 \uc774\ub86d\ub2e4"]
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return ["AI\ub294 \uc778\uac04\ubcf4\ub2e4 \uacf5\uc815\ud55c \ud310\ub2e8\uc744 \ub0b4\ub9ac\ub7ec \uc218 \uc788\ub2e4", "\uae30\uc220 \ubc1c\uc804\uc740 \ud56d\uc0c1 \uc774\ub86d\ub2e4"]
    return data if isinstance(data, list) else []


class OxEngine(BaseGameEngine):
    MAX_AGENTS = 5
    MAX_ROUNDS = 5

    def __init__(self, game: Game, db: Session):
        super().__init__(game, db)
        if "ox_state" not in (self.game.config or {}):
            self._init_ox_state()

    def _init_ox_state(self):
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        if len(participants) < self.MAX_AGENTS:
            self.game.config = (self.game.config or {}) | {
                "ox_state": {
                    "round": 0,
                    "phase": "waiting",
                    "question": "",
                    "agents": {},
                    "pending_actions": {},
                    "history": [],
                }
            }
            flag_modified(self.game, "config")
            self.db.commit()
            return

        questions = _load_questions()
        agent_ids = [p.agent_id for p in participants]
        agents = {}
        for aid in agent_ids:
            agents[aid] = {
                "first_choice": None,
                "final_choice": None,
                "switch_used": False,
                "switch_available": True,
                "total_points": 0,
                "comment": "",
            }
        round_idx = 0
        q_list = questions[: self.MAX_ROUNDS] if len(questions) >= self.MAX_ROUNDS else (questions + ["질문 없음"] * self.MAX_ROUNDS)[: self.MAX_ROUNDS]
        question = q_list[round_idx] if q_list else "질문 없음"

        self.game.config = (self.game.config or {}) | {
            "ox_state": {
                "round": 1,
                "phase": "first_choice",
                "question": question,
                "questions_per_round": q_list,
                "agents": agents,
                "pending_actions": {},
                "history": [],
            }
        }
        flag_modified(self.game, "config")
        self.db.commit()

    def _commit(self, os: dict):
        self.game.config = (self.game.config or {}) | {"ox_state": os}
        flag_modified(self.game, "config")
        self.db.commit()

    def _os(self) -> dict:
        return copy.deepcopy((self.game.config or {}).get("ox_state", {}))

    def _start_game(self):
        super()._start_game()
        self._init_ox_state()

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            os = self._os()
            phase = os.get("phase", "")
            agents = os.get("agents", {})
            if agent.id not in agents:
                return {"success": False, "error": "AGENT_NOT_IN_GAME"}
            if agent.id in os.get("pending_actions", {}):
                return {"success": False, "error": "ALREADY_ACTED"}

            if phase == "first_choice":
                if action.get("type") != "first_choice":
                    return {"success": False, "error": "FIRST_CHOICE_PHASE"}
                choice = (action.get("choice") or "O").upper()
                if choice not in ("O", "X"):
                    choice = "O"
                comment = (action.get("comment") or "").strip()[:MAX_COMMENT_LEN]
                os.setdefault("pending_actions", {})[agent.id] = {"type": "first_choice", "choice": choice, "comment": comment}
            elif phase == "switch":
                if action.get("type") != "switch":
                    return {"success": False, "error": "SWITCH_PHASE"}
                ag = agents.get(agent.id, {})
                use_switch = bool(action.get("use_switch", False))
                if use_switch and not ag.get("switch_available", False):
                    return {"success": False, "error": "SWITCH_NOT_AVAILABLE"}
                comment = (action.get("comment") or "").strip()[:MAX_COMMENT_LEN]
                os.setdefault("pending_actions", {})[agent.id] = {"type": "switch", "use_switch": use_switch, "comment": comment}
            else:
                return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}"}

            self._commit(os)

            if len(os.get("pending_actions", {})) >= len(agents):
                self._advance_phase()

        return {"success": True, "message": "제출되었습니다"}

    def _advance_phase(self):
        self.db.refresh(self.game)
        os = self._os()
        phase = os.get("phase", "")
        agents = os.get("agents", {})
        pending = os.get("pending_actions", {})

        if phase == "first_choice":
            for aid, act in pending.items():
                if aid in agents:
                    agents[aid]["first_choice"] = act.get("choice", "O")
                    agents[aid]["comment"] = act.get("comment", "")
            os["phase"] = "reveal"
            os["pending_actions"] = {}
            self._commit(os)
            self._advance_phase()
            return

        if phase == "reveal":
            os["phase"] = "switch"
            os["pending_actions"] = {}
            self._commit(os)
            return

        if phase == "switch":
            for aid, act in pending.items():
                if aid in agents:
                    ag = agents[aid]
                    if act.get("use_switch") and ag.get("switch_available"):
                        ag["final_choice"] = "X" if ag.get("first_choice") == "O" else "O"
                        ag["switch_used"] = True
                        ag["switch_available"] = False
                    else:
                        ag["final_choice"] = ag.get("first_choice") or "O"
            # 집계: 소수쪽에 포인트
            choices = [agents[aid].get("final_choice") or "O" for aid in agents]
            from collections import Counter
            dist = Counter(choices)
            o_count = dist.get("O", 0)
            x_count = dist.get("X", 0)
            if o_count < x_count:
                minority = "O"
                minority_count, majority_count = o_count, x_count
            elif x_count < o_count:
                minority = "X"
                minority_count, majority_count = x_count, o_count
            else:
                minority = None
                minority_count = majority_count = 0
            if minority is None:
                points_each = 0
            elif minority_count == 1:
                points_each = 12
            else:
                points_each = majority_count * 2
            for aid in agents:
                ag = agents[aid]
                fc = ag.get("final_choice") or "O"
                if minority and fc == minority:
                    ag["total_points"] = ag.get("total_points", 0) + points_each
            os["phase"] = "final_result"
            os["pending_actions"] = {}
            os.setdefault("history", []).append({
                "round": os.get("round", 1),
                "question": os.get("question"),
                "distribution": {"O": o_count, "X": x_count},
                "minority": minority,
                "points_awarded": points_each,
            })
            self._commit(os)

            # 다음 라운드 또는 게임 종료
            rnd = os.get("round", 1)
            if rnd >= self.MAX_ROUNDS:
                self.finish()
            else:
                q_list = os.get("questions_per_round", [])
                next_rnd = rnd + 1
                next_q = q_list[next_rnd - 1] if next_rnd <= len(q_list) else "질문 없음"
                os = self._os()
                os["round"] = next_rnd
                os["phase"] = "first_choice"
                os["question"] = next_q
                os["pending_actions"] = {}
                for aid in os.get("agents", {}):
                    os["agents"][aid]["first_choice"] = None
                    os["agents"][aid]["final_choice"] = None
                    os["agents"][aid]["comment"] = ""
                self._commit(os)
            return

        self._commit(os)

    def get_state(self, agent: Agent) -> dict:
        self.db.refresh(self.game)
        os = (self.game.config or {}).get("ox_state") or {}
        agents = os.get("agents", {})
        ag = agents.get(agent.id, {})
        phase = os.get("phase", "waiting")

        reveal = []
        if phase in ("reveal", "switch", "final_result"):
            from app.models.game import GameParticipant
            for p in self.db.query(GameParticipant).filter_by(game_id=self.game.id).all():
                a = self.db.query(Agent).filter_by(id=p.agent_id).first()
                ag_data = agents.get(p.agent_id, {})
                reveal.append({
                    "id": p.agent_id,
                    "name": a.name if a else p.agent_id,
                    "choice": ag_data.get("first_choice") or ag_data.get("final_choice") or "O",
                    "comment": ag_data.get("comment", ""),
                })

        scoreboard = []
        for aid, a in agents.items():
            agent_obj = self.db.query(Agent).filter_by(id=aid).first()
            scoreboard.append({"id": aid, "name": agent_obj.name if agent_obj else aid, "points": a.get("total_points", 0)})
        scoreboard.sort(key=lambda x: -x["points"])

        allowed = []
        if phase == "first_choice":
            allowed = ["first_choice"]
        elif phase == "switch":
            allowed = ["switch"]

        return {
            "gameStatus": self.game.status.value,
            "gameType": "ox",
            "round": os.get("round", 0),
            "maxRounds": self.MAX_ROUNDS,
            "phase": phase,
            "question": os.get("question", ""),
            "self": {
                "id": agent.id,
                "name": agent.name,
                "first_choice": ag.get("first_choice"),
                "switch_available": ag.get("switch_available", True),
                "total_points": ag.get("total_points", 0),
            },
            "reveal": reveal,
            "scoreboard": scoreboard,
            "history": os.get("history", []),
            "allowed_actions": allowed,
            "result": self._get_result(agent.id, os) if self.game.status == GameStatus.finished else None,
        }

    def _get_result(self, agent_id: str, os: dict) -> dict | None:
        agents = os.get("agents", {})
        ag = agents.get(agent_id, {})
        pts = ag.get("total_points", 0)
        scoreboard = sorted([(aid, a.get("total_points", 0)) for aid, a in agents.items()], key=lambda x: -x[1])
        rank = 1 + next((i for i, (aid, _) in enumerate(scoreboard) if aid == agent_id), 0)
        return {"points": pts, "rank": rank, "isWinner": rank == 1}

    def check_game_end(self) -> bool:
        os = (self.game.config or {}).get("ox_state") or {}
        return os.get("round", 0) >= self.MAX_ROUNDS and os.get("phase") == "final_result"

    def calculate_results(self) -> list[dict]:
        os = (self.game.config or {}).get("ox_state") or {}
        agents = os.get("agents", {})
        scoreboard = sorted(
            [{"agent_id": aid, "points": a.get("total_points", 0)} for aid, a in agents.items()],
            key=lambda x: -x["points"],
        )
        # coin 규칙: 1위 60점, 그 외 0점 (라운드 점수는 순위 결정용만 사용)
        results = []
        for rank, item in enumerate(scoreboard, start=1):
            pts = 60 if rank == 1 else 0
            results.append({"agent_id": item["agent_id"], "rank": rank, "points": pts})
        return results
