"""
모의재판(Mock Trial) 엔진. 5인(검사, 변호사, 배심원×3). 판사 없음.
순서: opening(주제 공개) → jury_first → argument_1 → jury_second → argument_2 → jury_final → verdict(결과/승점).
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


ROLES = ["PROSECUTOR", "DEFENSE", "JUROR", "JUROR", "JUROR"]
MAX_AGENTS_TRIAL = 5
MAX_SPEECH_LEN = 200

# 페이즈 순서: opening → jury_first → argument_1 → jury_second → argument_2 → jury_final → verdict
PHASES_JURY_VOTE = ("jury_first", "jury_second", "jury_final")
PHASES_ARGUMENT = ("argument_1", "argument_2")


def _get_action_guidance(phase: str, role: str) -> tuple[str, str]:
    """현재 phase·역할에 따라 기대 액션 타입과 에이전트용 한 줄 안내. (expected_action, action_instruction)"""
    if phase == "opening":
        return "ready", "Confirm you are ready: {\"type\": \"ready\"}"
    if phase in PHASES_JURY_VOTE:
        if role == "JUROR":
            return "vote", "Submit your verdict: {\"type\": \"vote\", \"verdict\": \"GUILTY\"} or {\"type\": \"vote\", \"verdict\": \"NOT_GUILTY\"}"
        return "pass", "No action needed (only JURORs vote). You are auto-passed."
    if phase in PHASES_ARGUMENT:
        if role in ("PROSECUTOR", "DEFENSE"):
            return "speak", "Submit your argument: {\"type\": \"speak\", \"text\": \"your one sentence\"} (max 200 chars)"
        return "pass", "No action needed (only PROSECUTOR/DEFENSE speak). You are auto-passed."
    if phase == "verdict":
        return "pass", "Trial ended. No action needed."
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
    MAX_AGENTS = MAX_AGENTS_TRIAL  # 5: 검사, 변호사, 배심원×3

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
            agents[aid] = {"role": role, "vote": None}  # vote는 최종(jury_final) 투표만 저장

        self.game.config = (self.game.config or {}) | {
            "trial_state": {
                "phase": "opening",
                "case": case,
                "agents": agents,
                "pending_actions": {},
                "history": [],
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
                if action.get("type") not in ("ready", "pass"):
                    return {"success": False, "error": "OPENING_REQUIRES_READY", "expected_action": "ready", "hint": "Send {\"type\": \"ready\"} to continue."}
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "ready"}
            elif phase in PHASES_JURY_VOTE:
                if role != "JUROR":
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                else:
                    if action.get("type") != "vote":
                        return {"success": False, "error": "JURY_VOTE_REQUIRES_VOTE", "expected_action": "vote", "hint": "Send {\"type\": \"vote\", \"verdict\": \"GUILTY\"} or {\"type\": \"vote\", \"verdict\": \"NOT_GUILTY\"}"}
                    verdict = (action.get("verdict") or "NOT_GUILTY").upper()
                    if verdict not in ("GUILTY", "NOT_GUILTY"):
                        verdict = "NOT_GUILTY"
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "vote", "verdict": verdict}
            elif phase in PHASES_ARGUMENT:
                if role not in ("PROSECUTOR", "DEFENSE"):
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                else:
                    if action.get("type") != "speak":
                        return {"success": False, "error": "ARGUMENT_REQUIRES_SPEAK", "expected_action": "speak", "hint": "Send {\"type\": \"speak\", \"text\": \"your argument\"} (max 200 chars)"}
                    text = (action.get("text") or "").strip()[:MAX_SPEECH_LEN]
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "speak", "text": text}
            elif phase == "verdict":
                return {"success": False, "error": "TRIAL_ENDED", "expected_action": "pass", "hint": "Trial has ended. No further actions."}
            else:
                return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}", "expected_action": "", "hint": "Wait for next phase."}

            self._commit(ts)

            pending = ts.get("pending_actions", {})
            need = self._required_submissions(ts)
            if len(pending) >= need:
                self._advance_phase()

        return {"success": True, "message": "제출되었습니다"}

    def _required_submissions(self, ts: dict) -> int:
        phase = ts.get("phase", "")
        agents = ts.get("agents", {})
        if phase == "opening":
            return len(agents)
        if phase in PHASES_JURY_VOTE:
            return sum(1 for a in agents.values() if a.get("role") == "JUROR")
        if phase in PHASES_ARGUMENT:
            return sum(1 for a in agents.values() if a.get("role") in ("PROSECUTOR", "DEFENSE"))
        if phase == "verdict":
            return 0
        return 0

    def _advance_phase(self):
        self.db.refresh(self.game)
        ts = self._ts()
        phase = ts.get("phase", "")
        agents = ts.get("agents", {})
        pending = ts.get("pending_actions", {})

        if phase == "opening":
            ts["phase"] = "jury_first"
            ts["pending_actions"] = {}
            ts.setdefault("history", []).append({"phase": "opening", "case_revealed": True})
            self._commit(ts)
            return

        if phase == "jury_first":
            ts.setdefault("history", []).append({
                "phase": "jury_first",
                "votes": [{"agent_id": aid, "verdict": p.get("verdict")} for aid, p in pending.items() if p.get("type") == "vote"]
            })
            ts["phase"] = "argument_1"
            ts["pending_actions"] = {}
            self._commit(ts)
            return

        if phase == "argument_1":
            ts.setdefault("history", []).append({
                "phase": "argument_1",
                "speeches": [{"agent_id": aid, "text": p.get("text", "")} for aid, p in pending.items() if p.get("type") == "speak"]
            })
            ts["phase"] = "jury_second"
            ts["pending_actions"] = {}
            self._commit(ts)
            return

        if phase == "jury_second":
            ts.setdefault("history", []).append({
                "phase": "jury_second",
                "votes": [{"agent_id": aid, "verdict": p.get("verdict")} for aid, p in pending.items() if p.get("type") == "vote"]
            })
            ts["phase"] = "argument_2"
            ts["pending_actions"] = {}
            self._commit(ts)
            return

        if phase == "argument_2":
            ts.setdefault("history", []).append({
                "phase": "argument_2",
                "speeches": [{"agent_id": aid, "text": p.get("text", "")} for aid, p in pending.items() if p.get("type") == "speak"]
            })
            ts["phase"] = "jury_final"
            ts["pending_actions"] = {}
            self._commit(ts)
            return

        if phase == "jury_final":
            votes = [p.get("verdict") for p in pending.values() if p.get("type") == "vote"]
            for aid, p in pending.items():
                if p.get("type") == "vote" and aid in agents:
                    agents[aid]["vote"] = p.get("verdict")
            guilty_count = sum(1 for v in votes if v == "GUILTY")
            verdict = "GUILTY" if guilty_count >= 2 else "NOT_GUILTY"
            winner_team = "PROSECUTOR" if verdict == "GUILTY" else "DEFENSE"
            ts.setdefault("history", []).append({
                "phase": "jury_final",
                "votes": [{"agent_id": aid, "verdict": p.get("verdict")} for aid, p in pending.items() if p.get("type") == "vote"]
            })
            ts["phase"] = "verdict"
            ts["verdict"] = verdict
            ts["winner_team"] = winner_team
            ts["pending_actions"] = {}
            # 리플레이용 로그: 최종 판정
            ts.setdefault("history", []).append({
                "phase": "verdict",
                "verdict": verdict,
                "winner_team": winner_team,
                "agents": [
                    {
                        "agent_id": aid,
                        "role": info.get("role"),
                        "final_vote": info.get("vote"),
                    }
                    for aid, info in agents.items()
                ],
            })
            self._commit(ts)
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
        if phase == "opening":
            allowed = ["ready"]
        elif phase in PHASES_JURY_VOTE:
            allowed = ["vote"]
        elif phase in PHASES_ARGUMENT:
            allowed = ["speak"]
        elif phase == "verdict":
            allowed = []

        submitted = len(ts.get("pending_actions", {}))
        total = self._required_submissions(ts)
        role = ag.get("role", "")
        expected_action, action_instruction = _get_action_guidance(phase, role)

        return {
            "gameStatus": self.game.status.value,
            "gameType": "trial",
            "phase": phase,
            "case": ts.get("case", {}),
            "self": {"id": agent.id, "role": role, "name": agent.name},
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
        # 3:0/2:1 유죄 → 검사 + 유죄 투표한 배심원만 승점. 3:0/2:1 무죄 → 변호 + 무죄 투표한 배심원만 승점.
        if winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and ts.get("agents", {}).get(agent_id, {}).get("vote") == "GUILTY")):
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
            vote = ar.get("vote")  # 최종(jury_final) 투표만 저장됨
            if winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and vote == "GUILTY")):
                pts = 20
            elif winner_team == "DEFENSE" and (role == "DEFENSE" or (role == "JUROR" and vote == "NOT_GUILTY")):
                pts = 20
            else:
                pts = 0
            results.append({"agent_id": aid, "rank": 1 if pts > 0 else 2, "points": pts})
        return sorted(results, key=lambda x: -x["points"])
