"""
마피아(Word Wolf) 엔진. 6인, hint_1~3 → vote → result → end.
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


PHASES = ["waiting", "hint_1", "hint_2", "hint_3", "vote", "result", "end"]
HINT_PHASES = ["hint_1", "hint_2", "hint_3"]
MAX_HINT_LEN = 100
MAX_REASON_LEN = 100


def _load_word_pairs() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "word_pairs.json"
    if not path.exists():
        return [
            {"citizen_word": "사과", "wolf_word": "배"},
            {"citizen_word": "피자", "wolf_word": "파스타"},
        ]
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class MafiaEngine(BaseGameEngine):
    MAX_AGENTS = 6

    def __init__(self, game: Game, db: Session):
        super().__init__(game, db)
        if "mafia_state" not in (self.game.config or {}):
            self._init_mafia_state()

    def _init_mafia_state(self):
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        if len(participants) < self.MAX_AGENTS:
            self.game.config = (self.game.config or {}) | {
                "mafia_state": {
                    "phase": "waiting",
                    "citizen_word": "",
                    "wolf_word": "",
                    "agents": {},
                    "pending_actions": {},
                    "history": [],
                }
            }
            flag_modified(self.game, "config")
            self.db.commit()
            return

        pairs = _load_word_pairs()
        pair = random.choice(pairs)
        citizen_word = pair["citizen_word"]
        wolf_word = pair["wolf_word"]
        agent_ids = [p.agent_id for p in participants]
        random.shuffle(agent_ids)
        wolf_count = self.game.config.get("wolf_count", 1)
        agents = {}
        for i, aid in enumerate(agent_ids):
            role = "WOLF" if i < wolf_count else "CITIZEN"
            word = wolf_word if role == "WOLF" else citizen_word
            agents[aid] = {"role": role, "secret_word": word, "alive": True}

        self.game.config = (self.game.config or {}) | {
            "mafia_state": {
                "phase": "hint_1",
                "citizen_word": citizen_word,
                "wolf_word": wolf_word,
                "agents": agents,
                "pending_actions": {},
                "history": [],
            }
        }
        flag_modified(self.game, "config")
        self.db.commit()

    def _commit(self, ms: dict):
        self.game.config = (self.game.config or {}) | {"mafia_state": ms}
        flag_modified(self.game, "config")
        self.db.commit()

    def _ms(self) -> dict:
        return copy.deepcopy((self.game.config or {}).get("mafia_state", {}))

    def _start_game(self):
        super()._start_game()
        self._init_mafia_state()

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ms = self._ms()
            phase = ms.get("phase", "waiting")
            agents = ms.get("agents", {})
            if agent.id not in agents:
                return {"success": False, "error": "AGENT_NOT_IN_GAME"}
            if agent.id in ms.get("pending_actions", {}):
                return {"success": False, "error": "ALREADY_ACTED"}

            if phase in HINT_PHASES:
                if action.get("type") != "hint":
                    return {"success": False, "error": "HINT_PHASE_REQUIRES_HINT"}
                text = (action.get("text") or "").strip()[:MAX_HINT_LEN]
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "hint", "text": text}
            elif phase == "vote":
                if action.get("type") != "vote":
                    return {"success": False, "error": "VOTE_PHASE_REQUIRES_VOTE"}
                target_id = action.get("target_id")
                if target_id == agent.id:
                    return {"success": False, "error": "CANNOT_VOTE_SELF"}
                if target_id not in agents:
                    return {"success": False, "error": "INVALID_TARGET"}
                reason = (action.get("reason") or "").strip()[:MAX_REASON_LEN]
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "vote", "target_id": target_id, "reason": reason}
            else:
                return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}"}

            self._commit(ms)

            # 전원 제출 시 다음 단계
            pending = ms.get("pending_actions", {})
            if len(pending) >= len(agents):
                self._advance_phase()

        return {"success": True, "message": "제출되었습니다"}

    def _advance_phase(self):
        self.db.refresh(self.game)
        ms = self._ms()
        phase = ms.get("phase", "waiting")
        agents = ms.get("agents", {})
        pending = ms.get("pending_actions", {})

        if phase in HINT_PHASES:
            history_entry = {"phase": phase, "hints": []}
            for aid, act in pending.items():
                ag = self.db.query(Agent).filter_by(id=aid).first()
                history_entry["hints"].append({
                    "agent_id": aid,
                    "name": ag.name if ag else aid,
                    "text": act.get("text", ""),
                })
            ms.setdefault("history", []).append(history_entry)
            ms["pending_actions"] = {}
            idx = PHASES.index(phase)
            ms["phase"] = PHASES[idx + 1]
            self._commit(ms)
            return

        if phase == "vote":
            # 집계: 최다 득표자 1명 추방
            votes = [p.get("target_id") for p in pending.values() if p.get("type") == "vote" and p.get("target_id")]
            from collections import Counter
            count = Counter(votes)
            if not count:
                eliminated_id = list(agents.keys())[0]
            else:
                max_votes = max(count.values())
                candidates = [tid for tid, c in count.items() if c == max_votes]
                eliminated_id = random.choice(candidates) if len(candidates) > 1 else candidates[0]
            eliminated_role = agents.get(eliminated_id, {}).get("role", "CITIZEN")
            # 동점이면 WOLF 승리 규칙: 동점 시에도 최다 득표 1명 추방. 추방자가 WOLF면 CITIZEN 승.
            winner = "CITIZEN" if eliminated_role == "WOLF" else "WOLF"
            ms["phase"] = "result"
            ms["eliminated_id"] = eliminated_id
            ms["eliminated_role"] = eliminated_role
            ms["winner"] = winner
            ms["vote_detail"] = [
                {"voter_id": aid, "target_id": p.get("target_id"), "reason": p.get("reason", "")}
                for aid, p in pending.items()
            ]
            ms["pending_actions"] = {}
            self._commit(ms)
            self.finish()
            return

        self._commit(ms)

    def get_state(self, agent: Agent) -> dict:
        self.db.refresh(self.game)
        ms = (self.game.config or {}).get("mafia_state") or {}
        agents = ms.get("agents", {})
        ag = agents.get(agent.id, {})
        phase = ms.get("phase", "waiting")

        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        participant_list = []
        for p in participants:
            a = self.db.query(Agent).filter_by(id=p.agent_id).first()
            submitted = p.agent_id in ms.get("pending_actions", {})
            participant_list.append({"id": p.agent_id, "name": a.name if a else p.agent_id, "submitted": submitted})

        allowed = []
        if phase in HINT_PHASES:
            allowed = ["hint"]
        elif phase == "vote":
            allowed = ["vote"]

        submitted = len(ms.get("pending_actions", {}))
        total = len(agents) if agents else len(participants)

        return {
            "gameStatus": self.game.status.value,
            "gameType": "mafia",
            "phase": phase,
            "round": HINT_PHASES.index(phase) + 1 if phase in HINT_PHASES else (4 if phase == "vote" else 5),
            "self": {
                "id": agent.id,
                "name": agent.name,
                "role": ag.get("role", "CITIZEN"),
                "secretWord": ag.get("secret_word", ""),
            },
            "participants": participant_list,
            "history": ms.get("history", []),
            "allowed_actions": allowed,
            "phase_submissions": {"submitted": submitted, "total": total},
            "result": self._get_result(agent.id, ms) if phase == "result" or phase == "end" else None,
        }

    def _get_result(self, agent_id: str, ms: dict) -> dict | None:
        winner = ms.get("winner")
        points = 20 if (winner == "CITIZEN" and ms.get("eliminated_role") == "WOLF") else (30 if winner == "WOLF" else 0)
        agents = ms.get("agents", {})
        ag = agents.get(agent_id, {})
        my_team = ag.get("role", "CITIZEN")
        is_winner = (winner == "CITIZEN" and my_team == "CITIZEN") or (winner == "WOLF" and my_team == "WOLF")
        if winner == "CITIZEN":
            pts = 20 if my_team == "CITIZEN" else 0
        else:
            pts = 30 if my_team == "WOLF" else 0
        return {
            "isWinner": is_winner,
            "points": pts,
            "winner": winner,
            "eliminated_role": ms.get("eliminated_role"),
            "citizen_word": ms.get("citizen_word"),
            "wolf_word": ms.get("wolf_word"),
        }

    def check_game_end(self) -> bool:
        ms = (self.game.config or {}).get("mafia_state") or {}
        return ms.get("phase") in ("result", "end")

    def calculate_results(self) -> list[dict]:
        ms = (self.game.config or {}).get("mafia_state") or {}
        winner = ms.get("winner", "CITIZEN")
        agents = ms.get("agents", {})
        results = []
        for aid, ag in agents.items():
            role = ag.get("role", "CITIZEN")
            if winner == "CITIZEN":
                pts = 20 if role == "CITIZEN" else 0
            else:
                pts = 30 if role == "WOLF" else 0
            results.append({"agent_id": aid, "rank": 1 if pts > 0 else 2, "points": pts})
        return sorted(results, key=lambda x: -x["points"])
