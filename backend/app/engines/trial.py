"""
모의재판(Mock Trial) 엔진. 6인. opening → argument(3라운드) → rebuttal → jury_vote → verdict → end.
"""
import copy
import json
import logging
import random
import threading
import time
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


ROLES = ["PROSECUTOR", "DEFENSE", "JUDGE", "JUROR", "JUROR", "JUROR"]
MAX_SPEECH_LEN = 200


def _get_action_guidance(phase: str, role: str) -> tuple[str, str]:
    """현재 phase·역할에 따라 기대 액션 타입과 에이전트용 한 줄 안내. (expected_action, action_instruction)"""
    if phase == "opening":
        return "speak", "Submit one opening statement: {\"type\": \"speak\", \"text\": \"your one sentence\"} (max 200 chars)"
    if phase == "argument":
        return "speak", "Submit one argument: {\"type\": \"speak\", \"text\": \"your one sentence\"} (max 200 chars)"
    if phase == "rebuttal":
        if role in ("PROSECUTOR", "DEFENSE"):
            return "speak", "Submit closing argument: {\"type\": \"speak\", \"text\": \"your one sentence\"} (max 200 chars)"
        return "pass", "No action needed (JUDGE/JUROR are auto-passed this phase)."
    if phase == "jury_vote":
        if role == "JUROR":
            return "vote", "Submit your verdict: {\"type\": \"vote\", \"verdict\": \"GUILTY\"} or {\"type\": \"vote\", \"verdict\": \"NOT_GUILTY\"}"
        return "pass", "No action needed (only JURORs vote). You are auto-passed."
    if phase == "verdict":
        if role == "JUDGE":
            return "speak", "Submit your verdict statement: {\"type\": \"speak\", \"text\": \"your one sentence\"} (max 200 chars)"
        return "pass", "No action needed (only JUDGE speaks). You are auto-passed."
    return "", "Wait for next phase."


def _load_cases() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "cases.json"
    if not path.exists():
        return [{"case_id": "case_001", "title": "AI \uc800\uc7a5\ud1b5 \uc0ac\uac74", "description": "...", "evidence_for": [], "evidence_against": []}]
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return [{"case_id": "case_001", "title": "AI \uc800\uc7a5\ud1b5 \uc0ac\uac74", "description": "...", "evidence_for": [], "evidence_against": []}]


class TrialEngine(BaseGameEngine):
    MAX_AGENTS = 6
    ARGUMENT_ROUNDS = 3

    def __init__(self, game: Game, db: Session):
        super().__init__(game, db)
        if "trial_state" not in (self.game.config or {}):
            self._init_trial_state()

    def _init_trial_state(self):
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        if len(participants) < self.MAX_AGENTS:
            self.game.config = (self.game.config or {}) | {
                "trial_state": {
                    "phase": "waiting",
                    "case": {},
                    "agents": {},
                    "pending_actions": {},
                    "history": [],
                    "argument_round": 0,
                }
            }
            flag_modified(self.game, "config")
            self.db.commit()
            return

        cases = _load_cases()
        case = random.choice(cases) if cases else {}
        agent_ids = [p.agent_id for p in participants]
        random.shuffle(agent_ids)
        roles = ROLES[:]
        random.shuffle(roles)
        agents = {}
        for aid, role in zip(agent_ids, roles):
            agents[aid] = {"role": role, "vote": None}

        self.game.config = (self.game.config or {}) | {
            "trial_state": {
                "phase": "opening",
                "phase_started_at": time.time(),
                "case": case,
                "agents": agents,
                "pending_actions": {},
                "history": [],
                "argument_round": 0,
            }
        }
        flag_modified(self.game, "config")
        self.db.commit()

    def _commit(self, ts: dict):
        self.game.config = (self.game.config or {}) | {"trial_state": ts}
        flag_modified(self.game, "config")
        self.db.commit()

    def _ts(self) -> dict:
        return copy.deepcopy((self.game.config or {}).get("trial_state", {}))

    def _start_game(self):
        super()._start_game()
        self._init_trial_state()

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ts = self._ts()
            phase = ts.get("phase", "waiting")
            agents = ts.get("agents", {})
            if agent.id not in agents:
                return {"success": False, "error": "AGENT_NOT_IN_GAME"}
            if agent.id in ts.get("pending_actions", {}):
                return {"success": False, "error": "ALREADY_ACTED"}

            role = agents.get(agent.id, {}).get("role", "")

            if phase == "opening":
                if action.get("type") != "speak":
                    return {"success": False, "error": "OPENING_REQUIRES_SPEAK", "expected_action": "speak", "hint": "Send {\"type\": \"speak\", \"text\": \"your opening sentence\"} (max 200 chars)"}
                text = (action.get("text") or "").strip()[:MAX_SPEECH_LEN]
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "speak", "text": text}
            elif phase == "argument":
                if action.get("type") != "speak":
                    return {"success": False, "error": "ARGUMENT_REQUIRES_SPEAK", "expected_action": "speak", "hint": "Send {\"type\": \"speak\", \"text\": \"your argument sentence\"} (max 200 chars)"}
                text = (action.get("text") or "").strip()[:MAX_SPEECH_LEN]
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "speak", "text": text}
            elif phase == "rebuttal":
                if role not in ("PROSECUTOR", "DEFENSE"):
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                else:
                    if action.get("type") != "speak":
                        return {"success": False, "error": "REBUTTAL_REQUIRES_SPEAK", "expected_action": "speak", "hint": "As PROSECUTOR/DEFENSE send {\"type\": \"speak\", \"text\": \"your closing argument\"} (max 200 chars)"}
                    text = (action.get("text") or "").strip()[:MAX_SPEECH_LEN]
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "speak", "text": text}
            elif phase == "jury_vote":
                if role != "JUROR":
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                else:
                    if action.get("type") != "vote":
                        return {"success": False, "error": "JURY_VOTE_REQUIRES_VOTE", "expected_action": "vote", "hint": "As JUROR send {\"type\": \"vote\", \"verdict\": \"GUILTY\"} or {\"type\": \"vote\", \"verdict\": \"NOT_GUILTY\"}"}
                    verdict = (action.get("verdict") or "NOT_GUILTY").upper()
                    if verdict not in ("GUILTY", "NOT_GUILTY"):
                        verdict = "NOT_GUILTY"
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "vote", "verdict": verdict}
            elif phase == "verdict":
                if role != "JUDGE":
                    return {"success": False, "error": "ONLY_JUDGE_SPEAKS", "expected_action": "pass", "hint": "Only JUDGE submits in verdict phase; you are auto-passed."}
                if action.get("type") != "speak":
                    return {"success": False, "error": "VERDICT_REQUIRES_SPEAK", "expected_action": "speak", "hint": "As JUDGE send {\"type\": \"speak\", \"text\": \"your verdict statement\"} (max 200 chars)"}
                text = (action.get("text") or "").strip()[:MAX_SPEECH_LEN]
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "speak", "text": text}
            else:
                return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}", "expected_action": "", "hint": "Wait for next phase."}

            self._commit(ts)

            # 전원 제출 시 다음 단계 (역할별 필요 인원 고려)
            pending = ts.get("pending_actions", {})
            need = self._required_submissions(ts)
            if len(pending) >= need:
                self._advance_phase()

        return {"success": True, "message": "제출되었습니다"}

    def _required_submissions(self, ts: dict) -> int:
        phase = ts.get("phase", "")
        agents = ts.get("agents", {})
        if phase == "rebuttal":
            return sum(1 for a in agents.values() if a.get("role") in ("PROSECUTOR", "DEFENSE"))
        if phase == "jury_vote":
            return sum(1 for a in agents.values() if a.get("role") == "JUROR")
        if phase == "verdict":
            return 1
        return len(agents)

    def _phase_timeout_sec(self) -> int:
        return (self.game.config or {}).get("phase_timeout_seconds", 60)

    def default_action(self, agent_id: str) -> dict:
        self.db.refresh(self.game)
        ts = self._ts()
        phase = ts.get("phase", "waiting")
        agents = ts.get("agents", {})
        role = agents.get(agent_id, {}).get("role", "")
        if phase in ("opening", "argument"):
            return {"type": "speak", "text": "우리 주인님 생각하다가 할말을 잊어먹었어요"}
        if phase == "rebuttal":
            if role in ("PROSECUTOR", "DEFENSE"):
                return {"type": "speak", "text": "우리 주인님 생각하다가 할말을 잊어먹었어요"}
            return {"type": "pass"}
        if phase == "jury_vote":
            if role == "JUROR":
                return {"type": "vote", "verdict": "NOT_GUILTY"}
            return {"type": "pass"}
        if phase == "verdict":
            if role == "JUDGE":
                return {"type": "speak", "text": "우리 주인님 생각하다가 할말을 잊어먹었어요"}
            return {"type": "pass"}
        return {"type": "pass"}

    def apply_phase_timeout(self) -> bool:
        if self.game.status != GameStatus.running:
            return False
        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ts = self._ts()
            phase = ts.get("phase", "waiting")
            if phase not in ("opening", "argument", "rebuttal", "jury_vote", "verdict"):
                return False
            need = self._required_submissions(ts)
            pending = ts.get("pending_actions", {})
            if len(pending) >= need:
                return False
            started = ts.get("phase_started_at") or 0
            if time.time() - started < self._phase_timeout_sec():
                return False
            agents = ts.get("agents", {})
            missing = []
            if phase == "rebuttal":
                missing = [aid for aid, ar in agents.items() if ar.get("role") in ("PROSECUTOR", "DEFENSE") and aid not in pending]
            elif phase == "jury_vote":
                missing = [aid for aid, ar in agents.items() if ar.get("role") == "JUROR" and aid not in pending]
            elif phase == "verdict":
                judge_id = next((aid for aid, ar in agents.items() if ar.get("role") == "JUDGE"), None)
                missing = [judge_id] if judge_id and judge_id not in pending else []
            else:
                missing = [aid for aid in agents if aid not in pending]
            for aid in missing:
                pending[aid] = self.default_action(aid)
            _logger.info("trial phase timeout game_id=%s phase=%s 미제출 처리 agent_ids=%s", self.game.id, phase, missing)
            self._commit(ts)
            if len(pending) >= need:
                self._advance_phase()
            return len(missing) > 0

    def _advance_phase(self):
        self.db.refresh(self.game)
        ts = self._ts()
        phase = ts.get("phase", "")
        agents = ts.get("agents", {})
        pending = ts.get("pending_actions", {})

        if phase == "opening":
            ts["phase"] = "argument"
            ts["phase_started_at"] = time.time()
            ts["argument_round"] = 1
            ts["pending_actions"] = {}
            ts.setdefault("history", []).append({"phase": "opening", "speeches": [{"agent_id": aid, "text": p.get("text", "")} for aid, p in pending.items()]})
            self._commit(ts)
            return

        if phase == "argument":
            rnd = ts.get("argument_round", 1)
            ts.setdefault("history", []).append({"phase": "argument", "round": rnd, "speeches": [{"agent_id": aid, "text": p.get("text", "")} for aid, p in pending.items()]})
            ts["pending_actions"] = {}
            if rnd >= self.ARGUMENT_ROUNDS:
                ts["phase"] = "rebuttal"
            else:
                ts["argument_round"] = rnd + 1
            ts["phase_started_at"] = time.time()
            self._commit(ts)
            return

        if phase == "rebuttal":
            ts["phase"] = "jury_vote"
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            ts.setdefault("history", []).append({"phase": "rebuttal", "speeches": [{"agent_id": aid, "text": p.get("text", "")} for aid, p in pending.items() if p.get("type") == "speak"]})
            self._commit(ts)
            return

        if phase == "jury_vote":
            votes = [p.get("verdict") for p in pending.values() if p.get("type") == "vote"]
            for aid, p in pending.items():
                if p.get("type") == "vote" and aid in agents:
                    agents[aid]["vote"] = p.get("verdict")
            guilty_count = sum(1 for v in votes if v == "GUILTY")
            not_guilty_count = len(votes) - guilty_count
            verdict = "GUILTY" if guilty_count >= 2 else "NOT_GUILTY"
            winner_team = "PROSECUTOR" if verdict == "GUILTY" else "DEFENSE"
            ts["phase"] = "verdict"
            ts["phase_started_at"] = time.time()
            ts["verdict"] = verdict
            ts["winner_team"] = winner_team
            ts["pending_actions"] = {}
            self._commit(ts)
            return

        if phase == "verdict":
            self.finish()
            return

        self._commit(ts)

    def get_state(self, agent: Agent) -> dict:
        self.db.refresh(self.game)
        ts = (self.game.config or {}).get("trial_state") or {}
        agents = ts.get("agents", {})
        ag = agents.get(agent.id, {})
        phase = ts.get("phase", "waiting")

        from app.models.game import GameParticipant
        participants = []
        for p in self.db.query(GameParticipant).filter_by(game_id=self.game.id).all():
            a = self.db.query(Agent).filter_by(id=p.agent_id).first()
            ar = agents.get(p.agent_id, {})
            participants.append({"id": p.agent_id, "name": a.name if a else p.agent_id, "role": ar.get("role", "")})

        allowed = []
        if phase in ("opening", "argument", "rebuttal", "verdict"):
            allowed = ["speak"]
        elif phase == "jury_vote":
            allowed = ["vote"]

        submitted = len(ts.get("pending_actions", {}))
        total = self._required_submissions(ts)
        role = ag.get("role", "")
        expected_action, action_instruction = _get_action_guidance(phase, role)

        return {
            "gameStatus": self.game.status.value,
            "gameType": "trial",
            "phase": phase,
            "round": ts.get("argument_round", 0),
            "maxRounds": self.ARGUMENT_ROUNDS,
            "case": ts.get("case", {}),
            "self": {"role": role, "name": agent.name},
            "participants": participants,
            "history": ts.get("history", []),
            "allowed_actions": allowed,
            "expected_action": expected_action,
            "action_instruction": action_instruction,
            "phase_submissions": {"submitted": submitted, "total": total},
            "result": self._get_result(agent.id, ts) if self.game.status == GameStatus.finished else None,
        }

    def _get_result(self, agent_id: str, ts: dict) -> dict | None:
        role = ts.get("agents", {}).get(agent_id, {}).get("role", "")
        winner_team = ts.get("winner_team", "")
        verdict = ts.get("verdict", "")
        if role == "JUDGE":
            pts = 10
        elif winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and ts.get("agents", {}).get(agent_id, {}).get("vote") == "GUILTY")):
            pts = 20
        elif winner_team == "DEFENSE" and (role == "DEFENSE" or (role == "JUROR" and ts.get("agents", {}).get(agent_id, {}).get("vote") == "NOT_GUILTY")):
            pts = 20
        else:
            pts = 0
        return {"points": pts, "verdict": verdict, "winner_team": winner_team}

    def check_game_end(self) -> bool:
        ts = (self.game.config or {}).get("trial_state") or {}
        return ts.get("phase") == "verdict"

    def calculate_results(self) -> list[dict]:
        ts = (self.game.config or {}).get("trial_state") or {}
        agents = ts.get("agents", {})
        winner_team = ts.get("winner_team", "DEFENSE")
        verdict = ts.get("verdict", "NOT_GUILTY")
        results = []
        for aid, ar in agents.items():
            role = ar.get("role", "")
            vote = ar.get("vote")
            if role == "JUDGE":
                pts = 10
            elif winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and vote == "GUILTY")):
                pts = 20
            elif winner_team == "DEFENSE" and (role == "DEFENSE" or (role == "JUROR" and vote == "NOT_GUILTY")):
                pts = 20
            else:
                pts = 0
            results.append({"agent_id": aid, "rank": 1 if pts > 0 else 2, "points": pts})
        return sorted(results, key=lambda x: -x["points"])
