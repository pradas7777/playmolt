"""
모의재판(Mock Trial) 엔진. 6인(JUDGE, 검사, 변호사, 배심원×3).
흐름: opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict.
엔진은 LLM 미사용. 유효 제출만 카운트하여 phase 진행(pass는 pending에 넣지 않음).
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


ROLES = ["JUDGE", "PROSECUTOR", "DEFENSE", "JUROR", "JUROR", "JUROR"]
MAX_AGENTS_TRIAL = 6

# 새 플로우 상수
PHASE_OPENING = "opening"
PHASE_ARG1 = "argument_1"
PHASE_JURY_INTERIM = "jury_interim"
PHASE_JUDGE_EXPAND = "judge_expand"
PHASE_ARG2 = "argument_2"
PHASE_JURY_FINAL = "jury_final"
PHASE_VERDICT = "verdict"

PHASE_ORDER = (
    PHASE_OPENING,
    PHASE_ARG1,
    PHASE_JURY_INTERIM,
    PHASE_JUDGE_EXPAND,
    PHASE_ARG2,
    PHASE_JURY_FINAL,
    PHASE_VERDICT,
)

# 길이 제한
MAX_CLAIM_LEN = 200
MAX_REASON_LEN = 180
MAX_QUESTION_LEN = 180
MAX_QUESTION_SUMMARY_LEN = 200
MAX_ADDED_FACT_TITLE = 80
MAX_ADDED_FACT_DETAIL = 240
MAX_EVIDENCE_KEY = 80
MAX_EVIDENCE_NOTE = 160


def _get_action_guidance(phase: str, role: str) -> tuple[str, str]:
    if phase == PHASE_OPENING:
        return "ready", "Confirm ready: {\"type\": \"ready\"}"
    if phase == PHASE_ARG1:
        if role in ("PROSECUTOR", "DEFENSE"):
            return "arg1", "{\"type\": \"arg1\", \"evidence_key\": \"<case에서 1개 선택>\", \"claim\": \"... (<=200)\"}"
        return "pass", "Not your turn. PROSECUTOR/DEFENSE only."
    if phase == PHASE_JURY_INTERIM:
        if role == "JUROR":
            return "jury_interim", "{\"type\": \"jury_interim\", \"verdict\": \"GUILTY\"|\"NOT_GUILTY\", \"reason\": \"... (<=180)\", \"question\": \"... (<=180)\"}"
        return "pass", "JURORs only."
    if phase == PHASE_JUDGE_EXPAND:
        if role == "JUDGE":
            return "judge_expand", "{\"type\": \"judge_expand\", \"question_summary\": \"...\", \"added_fact\": {\"title\": \"...\", \"detail\": \"...\"}, \"new_evidence_for\": [{\"key\": \"...\", \"note\": \"...\"}], \"new_evidence_against\": [{\"key\": \"...\", \"note\": \"...\"}]}"
        return "pass", "JUDGE only."
    if phase == PHASE_ARG2:
        if role in ("PROSECUTOR", "DEFENSE"):
            return "arg2", "{\"type\": \"arg2\", \"evidence_key\": \"<판사 추가 증거 중 1개>\", \"claim\": \"... (<=200)\"}"
        return "pass", "Not your turn. PROSECUTOR/DEFENSE only."
    if phase == PHASE_JURY_FINAL:
        if role == "JUROR":
            return "jury_final", "{\"type\": \"jury_final\", \"verdict\": \"GUILTY\"|\"NOT_GUILTY\", \"reason\": \"... (<=180)\"}"
        return "pass", "JURORs only."
    if phase == PHASE_VERDICT:
        return "pass", "Trial ended."
    return "", "Wait for next phase."


def _load_cases() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "cases.json"
    if not path.exists():
        return [
            {
                "case_id": "case_001",
                "title": "AI 저작권 침해 사건",
                "description": "AI가 생성한 저작물 관련",
                "evidence_for": ["학습 데이터 로그"],
                "evidence_against": ["원본 유사도 없음"],
            }
        ]
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return [data]
    except (json.JSONDecodeError, OSError):
        return [
            {
                "case_id": "case_001",
                "title": "AI 저작권 침해 사건",
                "description": "AI가 생성한 저작물 관련",
                "evidence_for": ["학습 데이터 로그"],
                "evidence_against": ["원본 유사도 없음"],
            }
        ]


def _empty_expansion() -> dict:
    return {
        "question_summary": "",
        "added_fact": {"title": "", "detail": ""},
        "new_evidence_for": [{"key": "", "note": ""}],
        "new_evidence_against": [{"key": "", "note": ""}],
    }


class TrialEngine(BaseGameEngine):
    MAX_AGENTS = MAX_AGENTS_TRIAL

    def __init__(self, game: Game, db: Session):
        super().__init__(game, db)
        ts = (self.game.config or {}).get("trial_state")
        if not ts or ts.get("phase") == "waiting":
            self._init_trial_state()

    def _init_trial_state(self):
        from app.models.game import GameParticipant
        participants = self.db.query(GameParticipant).filter_by(game_id=self.game.id).all()
        ts = (self.game.config or {}).get("trial_state") or {}
        current_phase = ts.get("phase", "waiting")

        if len(participants) < self.MAX_AGENTS:
            if not ts or current_phase != "waiting":
                self.game.config = (self.game.config or {}) | {
                    "trial_state": {
                        "phase": "waiting",
                        "case": {},
                        "agents": {},
                        "pending_actions": {},
                        "history": [],
                        "expansion": _empty_expansion(),
                    }
                }
                flag_modified(self.game, "config")
                self.db.commit()
            return

        if current_phase != "waiting":
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
                "phase": PHASE_OPENING,
                "phase_started_at": time.time(),
                "case": case,
                "agents": agents,
                "pending_actions": {},
                "history": [],
                "expansion": _empty_expansion(),
            }
        }
        flag_modified(self.game, "config")
        self.db.commit()
        _logger.info("trial game started game_id=%s phase=opening", self.game.id)

    def _commit(self, ts: dict):
        self.game.config = (self.game.config or {}) | {"trial_state": ts}
        flag_modified(self.game, "config")
        self.db.commit()

    def _ts(self) -> dict:
        return copy.deepcopy((self.game.config or {}).get("trial_state", {}))

    def _broadcast_trial_state(self):
        from app.core.connection_manager import manager
        to_send = self._ts()
        agents = to_send.get("agents") or {}
        for aid in agents:
            agent = self.db.query(Agent).filter_by(id=aid).first()
            agents[aid] = dict(agents[aid])
            agents[aid]["name"] = agent.name if agent else aid
        to_send["agents"] = agents
        manager.schedule_broadcast(self.game.id, {"type": "state_update", "trial_state": to_send})

    def _start_game(self):
        super()._start_game()
        self._init_trial_state()

    def _count_effective_submissions(self, ts: dict) -> int:
        phase = ts.get("phase", "")
        pending = ts.get("pending_actions", {})
        if phase == PHASE_OPENING:
            return sum(1 for p in pending.values() if p.get("type") == "ready")
        if phase == PHASE_ARG1:
            return sum(1 for p in pending.values() if p.get("type") == "arg1")
        if phase == PHASE_JURY_INTERIM:
            return sum(1 for p in pending.values() if p.get("type") == "jury_interim")
        if phase == PHASE_JUDGE_EXPAND:
            return sum(1 for p in pending.values() if p.get("type") == "judge_expand")
        if phase == PHASE_ARG2:
            return sum(1 for p in pending.values() if p.get("type") == "arg2")
        if phase == PHASE_JURY_FINAL:
            return sum(1 for p in pending.values() if p.get("type") == "jury_final")
        return 0

    def _required_submissions(self, ts: dict) -> int:
        phase = ts.get("phase", "")
        if phase == PHASE_OPENING:
            return 6
        if phase == PHASE_ARG1:
            return 2
        if phase == PHASE_JURY_INTERIM:
            return 3
        if phase == PHASE_JUDGE_EXPAND:
            return 1
        if phase == PHASE_ARG2:
            return 2
        if phase == PHASE_JURY_FINAL:
            return 3
        if phase == PHASE_VERDICT:
            return 0
        return 0

    def process_action(self, agent: Agent, action: dict) -> dict:
        if self.game.status != GameStatus.running:
            return {"success": False, "error": "GAME_NOT_RUNNING"}

        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ts = self._ts()
            phase = ts.get("phase", "waiting")
            if phase == "waiting":
                self._init_trial_state()
                self.db.refresh(self.game)
                ts = self._ts()
                phase = ts.get("phase", "waiting")
            agents = ts.get("agents", {})
            if agent.id not in agents:
                return {"success": False, "error": "AGENT_NOT_IN_GAME"}
            pending = ts.get("pending_actions", {})
            if agent.id in pending:
                if action.get("type") == "pass":
                    return {"success": True, "message": "이미 제출됨 (pass no-op)"}
                return {"success": False, "error": "ALREADY_ACTED"}

            role = agents.get(agent.id, {}).get("role", "")
            atype = action.get("type") or ""

            # --- opening: ready만 허용, pending에 ready만 기록 ---
            if phase == PHASE_OPENING:
                if atype != "ready":
                    return {"success": False, "error": "OPENING_REQUIRES_READY", "expected_action": "ready", "hint": "Send {\"type\": \"ready\"}."}
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "ready"}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            # --- argument_1: 검사/변호만 arg1, evidence_key 검증 ---
            if phase == PHASE_ARG1:
                if role not in ("PROSECUTOR", "DEFENSE"):
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                    self._commit(ts)
                    self._broadcast_trial_state()
                    return {"success": True, "message": "NOT_ACTOR_THIS_PHASE"}
                if atype != "arg1":
                    return {"success": False, "error": "ARG1_REQUIRED", "expected_action": "arg1", "hint": "{\"type\": \"arg1\", \"evidence_key\": \"...\", \"claim\": \"...\"}"}
                case = ts.get("case", {})
                evidence_key = (action.get("evidence_key") or "").strip()
                claim = (action.get("claim") or "").strip()[:MAX_CLAIM_LEN]
                if role == "PROSECUTOR":
                    allowed = case.get("evidence_for") or []
                else:
                    allowed = case.get("evidence_against") or []
                if not isinstance(allowed, list):
                    allowed = []
                if evidence_key not in allowed:
                    return {"success": False, "error": "INVALID_EVIDENCE_KEY", "expected_action": "arg1", "hint": f"evidence_key must be one of: {allowed}"}
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "arg1", "evidence_key": evidence_key, "claim": claim, "role": role}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            # --- jury_interim: 배심원만 jury_interim, reason/question 필수 ---
            if phase == PHASE_JURY_INTERIM:
                if role != "JUROR":
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                    self._commit(ts)
                    self._broadcast_trial_state()
                    return {"success": True, "message": "NOT_ACTOR_THIS_PHASE"}
                if atype != "jury_interim":
                    return {"success": False, "error": "JURY_INTERIM_REQUIRED", "expected_action": "jury_interim", "hint": "verdict, reason, question required."}
                verdict = (action.get("verdict") or "NOT_GUILTY").upper()
                if verdict not in ("GUILTY", "NOT_GUILTY"):
                    verdict = "NOT_GUILTY"
                reason = (action.get("reason") or "").strip()[:MAX_REASON_LEN]
                question = (action.get("question") or "").strip()[:MAX_QUESTION_LEN]
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "jury_interim", "verdict": verdict, "reason": reason, "question": question}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            # --- judge_expand: 판사만, 스키마 검증(리스트 길이 1) ---
            if phase == PHASE_JUDGE_EXPAND:
                if role != "JUDGE":
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                    self._commit(ts)
                    self._broadcast_trial_state()
                    return {"success": True, "message": "NOT_ACTOR_THIS_PHASE"}
                if atype != "judge_expand":
                    return {"success": False, "error": "JUDGE_EXPAND_REQUIRED", "expected_action": "judge_expand", "hint": "question_summary, added_fact, new_evidence_for[1], new_evidence_against[1]"}
                qs = (action.get("question_summary") or "").strip()[:MAX_QUESTION_SUMMARY_LEN]
                af = action.get("added_fact")
                if not isinstance(af, dict):
                    af = {}
                added_fact = {
                    "title": (af.get("title") or "").strip()[:MAX_ADDED_FACT_TITLE],
                    "detail": (af.get("detail") or "").strip()[:MAX_ADDED_FACT_DETAIL],
                }
                nef = action.get("new_evidence_for")
                nea = action.get("new_evidence_against")
                if not isinstance(nef, list) or len(nef) != 1:
                    return {"success": False, "error": "NEW_EVIDENCE_FOR_LEN_1", "expected_action": "judge_expand"}
                if not isinstance(nea, list) or len(nea) != 1:
                    return {"success": False, "error": "NEW_EVIDENCE_AGAINST_LEN_1", "expected_action": "judge_expand"}
                e1 = nef[0] if isinstance(nef[0], dict) else {}
                e2 = nea[0] if isinstance(nea[0], dict) else {}
                new_evidence_for = [{"key": (e1.get("key") or "").strip()[:MAX_EVIDENCE_KEY], "note": (e1.get("note") or "").strip()[:MAX_EVIDENCE_NOTE]}]
                new_evidence_against = [{"key": (e2.get("key") or "").strip()[:MAX_EVIDENCE_KEY], "note": (e2.get("note") or "").strip()[:MAX_EVIDENCE_NOTE]}]
                expansion = {
                    "question_summary": qs,
                    "added_fact": added_fact,
                    "new_evidence_for": new_evidence_for,
                    "new_evidence_against": new_evidence_against,
                }
                ts["expansion"] = expansion
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "judge_expand", "expansion": expansion}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            # --- argument_2: 검사/변호만 arg2, evidence_key는 expansion 신규 증거 중 하나 ---
            if phase == PHASE_ARG2:
                if role not in ("PROSECUTOR", "DEFENSE"):
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                    self._commit(ts)
                    self._broadcast_trial_state()
                    return {"success": True, "message": "NOT_ACTOR_THIS_PHASE"}
                if atype != "arg2":
                    return {"success": False, "error": "ARG2_REQUIRED", "expected_action": "arg2", "hint": "{\"type\": \"arg2\", \"evidence_key\": \"<expansion에서 1개>\", \"claim\": \"...\"}"}
                expansion = ts.get("expansion") or _empty_expansion()
                keys_for = [e.get("key", "") for e in (expansion.get("new_evidence_for") or []) if e.get("key")]
                keys_against = [e.get("key", "") for e in (expansion.get("new_evidence_against") or []) if e.get("key")]
                allowed_keys = keys_for + keys_against
                evidence_key = (action.get("evidence_key") or "").strip()
                claim = (action.get("claim") or "").strip()[:MAX_CLAIM_LEN]
                if evidence_key not in allowed_keys:
                    return {"success": False, "error": "INVALID_EVIDENCE_KEY_ARG2", "expected_action": "arg2", "hint": f"evidence_key must be one of expansion keys: {allowed_keys}"}
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "arg2", "evidence_key": evidence_key, "claim": claim, "role": role}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            # --- jury_final: 배심원만 jury_final, reason 필수 ---
            if phase == PHASE_JURY_FINAL:
                if role != "JUROR":
                    ts.setdefault("pending_actions", {})[agent.id] = {"type": "pass"}
                    self._commit(ts)
                    self._broadcast_trial_state()
                    return {"success": True, "message": "NOT_ACTOR_THIS_PHASE"}
                if atype != "jury_final":
                    return {"success": False, "error": "JURY_FINAL_REQUIRED", "expected_action": "jury_final", "hint": "verdict, reason required."}
                verdict = (action.get("verdict") or "NOT_GUILTY").upper()
                if verdict not in ("GUILTY", "NOT_GUILTY"):
                    verdict = "NOT_GUILTY"
                reason = (action.get("reason") or "").strip()[:MAX_REASON_LEN]
                ts.setdefault("pending_actions", {})[agent.id] = {"type": "jury_final", "verdict": verdict, "reason": reason}
                self._commit(ts)
                self._broadcast_trial_state()
                if self._count_effective_submissions(ts) >= self._required_submissions(ts):
                    self._advance_phase()
                return {"success": True, "message": "제출되었습니다"}

            if phase == PHASE_VERDICT:
                return {"success": False, "error": "TRIAL_ENDED", "expected_action": "pass", "hint": "Trial has ended."}

            return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}", "expected_action": "", "hint": "Wait for next phase."}

    def default_action(self, agent_id: str) -> dict:
        self.db.refresh(self.game)
        ts = self._ts()
        phase = ts.get("phase", "waiting")
        agents = ts.get("agents", {})
        role = agents.get(agent_id, {}).get("role", "")
        case = ts.get("case", {})

        if phase == PHASE_OPENING:
            return {"type": "ready"}
        if phase == PHASE_ARG1:
            if role == "PROSECUTOR":
                ev = (case.get("evidence_for") or [])
                key = ev[0] if ev else "증거"
                return {"type": "arg1", "evidence_key": key, "claim": "1차 주장 제출."[:MAX_CLAIM_LEN]}
            if role == "DEFENSE":
                ev = (case.get("evidence_against") or [])
                key = ev[0] if ev else "반증"
                return {"type": "arg1", "evidence_key": key, "claim": "1차 반박 제출."[:MAX_CLAIM_LEN]}
            return {"type": "pass"}
        if phase == PHASE_JURY_INTERIM:
            if role == "JUROR":
                return {"type": "jury_interim", "verdict": "NOT_GUILTY", "reason": "추가 검토 필요."[:MAX_REASON_LEN], "question": "증거 확정 여부?"[:MAX_QUESTION_LEN]}
            return {"type": "pass"}
        if phase == PHASE_JUDGE_EXPAND:
            if role == "JUDGE":
                return {
                    "type": "judge_expand",
                    "question_summary": "배심원 질문 요약."[:MAX_QUESTION_SUMMARY_LEN],
                    "added_fact": {"title": "추가 상황."[:MAX_ADDED_FACT_TITLE], "detail": "상세."[:MAX_ADDED_FACT_DETAIL]},
                    "new_evidence_for": [{"key": "(판사추가)추가 검찰 증거."[:MAX_EVIDENCE_KEY], "note": "요약."[:MAX_EVIDENCE_NOTE]}],
                    "new_evidence_against": [{"key": "(판사추가)추가 변호 증거."[:MAX_EVIDENCE_KEY], "note": "요약."[:MAX_EVIDENCE_NOTE]}],
                }
            return {"type": "pass"}
        if phase == PHASE_ARG2:
            if role in ("PROSECUTOR", "DEFENSE"):
                expansion = ts.get("expansion") or _empty_expansion()
                keys_for = [e.get("key", "") for e in (expansion.get("new_evidence_for") or []) if e.get("key")]
                keys_against = [e.get("key", "") for e in (expansion.get("new_evidence_against") or []) if e.get("key")]
                all_keys = keys_for + keys_against
                key = all_keys[0] if all_keys else "(판사추가)증거"
                return {"type": "arg2", "evidence_key": key, "claim": "2차 주장 제출."[:MAX_CLAIM_LEN]}
            return {"type": "pass"}
        if phase == PHASE_JURY_FINAL:
            if role == "JUROR":
                return {"type": "jury_final", "verdict": "NOT_GUILTY", "reason": "최종 판단."[:MAX_REASON_LEN]}
            return {"type": "pass"}
        if phase == PHASE_VERDICT:
            return {"type": "pass"}
        return {"type": "pass"}

    def _phase_timeout_sec(self) -> int:
        return (self.game.config or {}).get("phase_timeout_seconds", 30)

    def apply_phase_timeout(self) -> bool:
        if self.game.status != GameStatus.running:
            return False
        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ts = self._ts()
            phase = ts.get("phase", "waiting")
            if phase not in PHASE_ORDER or phase == PHASE_VERDICT:
                return False
            need = self._required_submissions(ts)
            if self._count_effective_submissions(ts) >= need:
                return False
            started = ts.get("phase_started_at") or 0
            if time.time() - started < self._phase_timeout_sec():
                return False
            agents = ts.get("agents", {})
            pending = ts.get("pending_actions", {})
            missing = [aid for aid in agents if aid not in pending]
            for aid in missing:
                default = self.default_action(aid)
                if default.get("type") != "pass":
                    pending[aid] = default
            _logger.info("trial phase timeout game_id=%s phase=%s 미제출 agent_ids=%s", self.game.id, phase, missing)
            self._commit(ts)
            self._broadcast_trial_state()
            if self._count_effective_submissions(ts) >= need:
                self._advance_phase()
            return len(missing) > 0

    def _advance_phase(self):
        self.db.refresh(self.game)
        ts = self._ts()
        phase = ts.get("phase", "")
        agents = ts.get("agents", {})
        pending = ts.get("pending_actions", {})

        if phase == PHASE_OPENING:
            ts.setdefault("history", []).append({"phase": "opening"})
            ts["phase"] = PHASE_ARG1
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            self._commit(ts)
            self._broadcast_trial_state()
            return

        if phase == PHASE_ARG1:
            moves = [{"agent_id": aid, "role": p.get("role"), "evidence_key": p.get("evidence_key"), "claim": p.get("claim")} for aid, p in pending.items() if p.get("type") == "arg1"]
            ts.setdefault("history", []).append({"phase": "argument_1", "moves": moves})
            ts["phase"] = PHASE_JURY_INTERIM
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            self._commit(ts)
            self._broadcast_trial_state()
            return

        if phase == PHASE_JURY_INTERIM:
            votes = [{"agent_id": aid, "verdict": p.get("verdict"), "reason": p.get("reason"), "question": p.get("question")} for aid, p in pending.items() if p.get("type") == "jury_interim"]
            ts.setdefault("history", []).append({"phase": "jury_interim", "votes": votes})
            ts["phase"] = PHASE_JUDGE_EXPAND
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            self._commit(ts)
            self._broadcast_trial_state()
            return

        if phase == PHASE_JUDGE_EXPAND:
            judge_p = next((p for p in pending.values() if p.get("type") == "judge_expand"), {})
            if judge_p.get("expansion"):
                expansion = judge_p["expansion"]
            elif judge_p.get("question_summary") is not None:
                expansion = {
                    "question_summary": judge_p.get("question_summary", ""),
                    "added_fact": judge_p.get("added_fact", {"title": "", "detail": ""}),
                    "new_evidence_for": judge_p.get("new_evidence_for", [{"key": "", "note": ""}]),
                    "new_evidence_against": judge_p.get("new_evidence_against", [{"key": "", "note": ""}]),
                }
            else:
                expansion = ts.get("expansion") or _empty_expansion()
            ts["expansion"] = expansion
            ts.setdefault("history", []).append({
                "phase": "judge_expand",
                "question_summary": expansion.get("question_summary"),
                "added_fact": expansion.get("added_fact"),
                "new_evidence_for": expansion.get("new_evidence_for"),
                "new_evidence_against": expansion.get("new_evidence_against"),
            })
            ts["phase"] = PHASE_ARG2
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            self._commit(ts)
            self._broadcast_trial_state()
            return

        if phase == PHASE_ARG2:
            moves = [{"agent_id": aid, "role": p.get("role"), "evidence_key": p.get("evidence_key"), "claim": p.get("claim")} for aid, p in pending.items() if p.get("type") == "arg2"]
            ts.setdefault("history", []).append({"phase": "argument_2", "moves": moves})
            ts["phase"] = PHASE_JURY_FINAL
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            self._commit(ts)
            self._broadcast_trial_state()
            return

        if phase == PHASE_JURY_FINAL:
            votes = [{"agent_id": aid, "verdict": p.get("verdict"), "reason": p.get("reason")} for aid, p in pending.items() if p.get("type") == "jury_final"]
            for aid, p in pending.items():
                if p.get("type") == "jury_final" and aid in agents:
                    agents[aid]["vote"] = p.get("verdict")
            guilty_count = sum(1 for v in votes if v.get("verdict") == "GUILTY")
            verdict = "GUILTY" if guilty_count >= 2 else "NOT_GUILTY"
            winner_team = "PROSECUTOR" if verdict == "GUILTY" else "DEFENSE"
            ts["verdict"] = verdict
            ts["winner_team"] = winner_team
            ts.setdefault("history", []).append({"phase": "jury_final", "votes": votes})
            ts["phase"] = PHASE_VERDICT
            ts["phase_started_at"] = time.time()
            ts["pending_actions"] = {}
            ts.setdefault("history", []).append({
                "phase": "verdict",
                "verdict": verdict,
                "winner_team": winner_team,
                "agents": [{"agent_id": aid, "role": info.get("role"), "final_vote": info.get("vote")} for aid, info in agents.items()],
            })
            self._commit(ts)
            self._broadcast_trial_state()
            self.finish()
            return

        self._commit(ts)
        self._broadcast_trial_state()

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
        if phase == PHASE_OPENING:
            allowed = ["ready"]
        elif phase == PHASE_ARG1:
            allowed = ["arg1"] if ag.get("role") in ("PROSECUTOR", "DEFENSE") else []
        elif phase == PHASE_JURY_INTERIM:
            allowed = ["jury_interim"] if ag.get("role") == "JUROR" else []
        elif phase == PHASE_JUDGE_EXPAND:
            allowed = ["judge_expand"] if ag.get("role") == "JUDGE" else []
        elif phase == PHASE_ARG2:
            allowed = ["arg2"] if ag.get("role") in ("PROSECUTOR", "DEFENSE") else []
        elif phase == PHASE_JURY_FINAL:
            allowed = ["jury_final"] if ag.get("role") == "JUROR" else []
        elif phase == PHASE_VERDICT:
            allowed = []

        pending = ts.get("pending_actions", {})
        effective = self._count_effective_submissions(ts)
        total = self._required_submissions(ts)
        role = ag.get("role", "")
        expected_action, action_instruction = _get_action_guidance(phase, role)
        if agent.id in pending:
            expected_action = "pass"
            action_instruction = "Already submitted this phase. Wait for others."

        return {
            "gameStatus": self.game.status.value,
            "gameType": "trial",
            "phase": phase,
            "case": ts.get("case", {}),
            "expansion": ts.get("expansion") or _empty_expansion(),
            "self": {"id": agent.id, "role": role, "name": agent.name},
            "participants": participants,
            "history": ts.get("history", []),
            "allowed_actions": allowed,
            "expected_action": expected_action,
            "action_instruction": action_instruction,
            "phase_submissions": {"submitted": effective, "total": total},
            "result": self._get_result(agent.id, ts) if self.game.status == GameStatus.finished else None,
        }

    def _get_result(self, agent_id: str, ts: dict) -> dict | None:
        role = ts.get("agents", {}).get(agent_id, {}).get("role", "")
        if role == "JUDGE":
            return {"points": 20, "verdict": ts.get("verdict", ""), "winner_team": ts.get("winner_team", ""), "role": "JUDGE"}
        winner_team = ts.get("winner_team", "")
        verdict = ts.get("verdict", "")
        if winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and ts.get("agents", {}).get(agent_id, {}).get("vote") == "GUILTY")):
            pts = 40
        elif winner_team == "DEFENSE" and (role == "DEFENSE" or (role == "JUROR" and ts.get("agents", {}).get(agent_id, {}).get("vote") == "NOT_GUILTY")):
            pts = 40
        else:
            pts = 0
        return {"points": pts, "verdict": verdict, "winner_team": winner_team, "role": role}

    def check_game_end(self) -> bool:
        ts = (self.game.config or {}).get("trial_state") or {}
        return ts.get("phase") == PHASE_VERDICT

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
                pts = 20
            elif winner_team == "PROSECUTOR" and (role == "PROSECUTOR" or (role == "JUROR" and vote == "GUILTY")):
                pts = 40
            elif winner_team == "DEFENSE" and (role == "DEFENSE" or (role == "JUROR" and vote == "NOT_GUILTY")):
                pts = 40
            else:
                pts = 0
            results.append({"agent_id": aid, "rank": 1 if pts > 0 else 2, "points": pts})
        return sorted(results, key=lambda x: -x["points"])
