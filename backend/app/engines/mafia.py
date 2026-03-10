"""
마피아(Word Wolf) 엔진. 5인, hint → suspect → final → vote → revote(동점시) → result → end.
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

SUSPECT_REASON_CODES = ("AMBIGUOUS", "TOO_SPECIFIC", "OFF_TONE", "ETC")


def _get_action_lock(game_id: str) -> threading.Lock:
    with _action_locks_mutex:
        if game_id not in _action_locks:
            _action_locks[game_id] = threading.Lock()
        return _action_locks[game_id]


PHASES = ["waiting", "hint", "suspect", "final", "vote", "revote", "result", "end"]
ACTION_PHASES = ["hint", "suspect", "final", "vote", "revote"]
MAX_HINT_LEN = 100
MAX_FINAL_MIN = 40
MAX_FINAL_MAX = 140


def _fix_word_encoding(s: str) -> str:
    """DB에 깨져 저장된 한글 복구 시도."""
    if not s or not isinstance(s, str):
        return s or ""
    try:
        if "\ufffd" not in s and s.encode("utf-8").decode("utf-8") == s:
            return s
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    for enc in ("latin-1", "cp1252", "cp949", "iso-8859-1", "euc-kr"):
        try:
            fixed = s.encode(enc).decode("utf-8")
            if "\ufffd" not in fixed and 0 < len(fixed) <= 30:
                return fixed
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    try:
        b = s.encode("utf-8")
        fixed = b.decode("cp949")
        if "\ufffd" not in fixed and 0 < len(fixed) <= 30:
            return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return s


def _is_valid_utf8_word(w: str) -> bool:
    if not w or "\ufffd" in w:
        return False
    try:
        w.encode("utf-8").decode("utf-8")
        return True
    except (UnicodeEncodeError, UnicodeDecodeError):
        return False


_DEFAULT_WORD_PAIRS_JSON = (
    '[{"citizen_word":"\uc0ac\uacfc","wolf_word":"\ub0b4"},'
    '{"citizen_word":"\ud2f0\uc790","wolf_word":"\ud30c\uc2a4\ud0c0"}]'
)


def _load_word_pairs() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "word_pairs.json"
    if not path.exists():
        return json.loads(_DEFAULT_WORD_PAIRS_JSON)
    data = None
    for enc in ("utf-8", "utf-8-sig", "cp949"):
        try:
            with open(path, "r", encoding=enc) as f:
                data = json.load(f)
            break
        except UnicodeDecodeError:
            continue
        except (json.JSONDecodeError, OSError) as e:
            _logger.warning("word_pairs.json 로드 실패 (%s): %s", enc, e)
            break
    if not isinstance(data, list) or not data:
        return json.loads(_DEFAULT_WORD_PAIRS_JSON)
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        cw = (item.get("common_word") or item.get("citizen_word") or "").strip()
        ww = (item.get("odd_word") or item.get("wolf_word") or "").strip()
        if _is_valid_utf8_word(cw) and _is_valid_utf8_word(ww):
            out.append({"common_word": cw, "odd_word": ww})
    if not out:
        fallback = json.loads(_DEFAULT_WORD_PAIRS_JSON)
        for item in fallback:
            cw = item.get("citizen_word", "")
            ww = item.get("wolf_word", "")
            out.append({"common_word": cw, "odd_word": ww})
        _logger.warning("word_pairs.json에 유효한 UTF-8 단어쌍 없음, 폴백 사용")
    return out


class MafiaEngine(BaseGameEngine):
    MAX_AGENTS = 5

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
                    "common_word": "",
                    "odd_word": "",
                    "agents": {},
                    "pending_actions": {},
                    "history": [],
                    "revote_round": 0,
                    "revote_candidates": [],
                }
            }
            flag_modified(self.game, "config")
            self.db.commit()
            return

        pairs = _load_word_pairs()
        pair = random.choice(pairs)
        common_word = (pair.get("common_word") or "").strip()
        odd_word = (pair.get("odd_word") or "").strip()
        if not _is_valid_utf8_word(common_word) or not _is_valid_utf8_word(odd_word):
            fallback = json.loads(_DEFAULT_WORD_PAIRS_JSON)
            pair = fallback[0]
            common_word = pair.get("citizen_word", pair.get("common_word", ""))
            odd_word = pair.get("wolf_word", pair.get("odd_word", ""))
            _logger.warning("마피아 단어 검증 실패, 폴백 단어쌍 사용")
        agent_ids = [p.agent_id for p in participants]
        random.shuffle(agent_ids)
        wolf_count = self.game.config.get("wolf_count", 1)
        agents = {}
        for i, aid in enumerate(agent_ids):
            role = "WOLF" if i < wolf_count else "CITIZEN"
            word = odd_word if role == "WOLF" else common_word
            agents[aid] = {"role": role, "secret_word": word, "alive": True}

        self.game.config = (self.game.config or {}) | {
            "mafia_state": {
                "phase": "hint",
                "phase_started_at": time.time(),
                "common_word": common_word,
                "odd_word": odd_word,
                "agents": agents,
                "pending_actions": {},
                "history": [],
                "revote_round": 0,
                "revote_candidates": [],
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

    def _broadcast_mafia_state(self):
        from app.core.connection_manager import manager
        to_send = self._ms()
        agents = to_send.get("agents") or {}
        phase = to_send.get("phase", "waiting")
        for aid in agents:
            agent = self.db.query(Agent).filter_by(id=aid).first()
            agents[aid] = dict(agents[aid])
            agents[aid]["name"] = agent.name if agent else aid
        if phase not in ("result", "end"):
            to_send = dict(to_send)
            to_send["common_word"] = None
            to_send["odd_word"] = None
            to_send["agents"] = {aid: {k: v for k, v in a.items() if k not in ("secret_word", "role")} for aid, a in agents.items()}
        else:
            to_send["agents"] = agents
        to_send["phase_timeout_seconds"] = self._phase_timeout_sec()
        manager.schedule_broadcast(self.game.id, {"type": "state_update", "mafia_state": to_send})

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

            if phase == "hint":
                if action.get("type") != "hint":
                    return {"success": False, "error": "HINT_PHASE_REQUIRES_HINT"}
                text = (action.get("text") or "").strip()[:MAX_HINT_LEN]
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "hint", "text": text}
            elif phase == "suspect":
                if action.get("type") != "suspect":
                    return {"success": False, "error": "SUSPECT_PHASE_REQUIRES_SUSPECT"}
                target_id = action.get("target_id")
                if target_id == agent.id:
                    return {"success": False, "error": "CANNOT_SUSPECT_SELF"}
                if target_id not in agents:
                    return {"success": False, "error": "INVALID_TARGET"}
                reason_code = (action.get("reason_code") or "ETC").upper()
                if reason_code not in SUSPECT_REASON_CODES:
                    reason_code = "ETC"
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "suspect", "target_id": target_id, "reason_code": reason_code}
            elif phase == "final":
                if action.get("type") != "final":
                    return {"success": False, "error": "FINAL_PHASE_REQUIRES_FINAL"}
                text = (action.get("text") or "").strip()
                if len(text) < MAX_FINAL_MIN or len(text) > MAX_FINAL_MAX:
                    return {"success": False, "error": f"FINAL_TEXT_LENGTH_{MAX_FINAL_MIN}_TO_{MAX_FINAL_MAX}"}
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "final", "text": text}
            elif phase in ("vote", "revote"):
                if action.get("type") != "vote":
                    return {"success": False, "error": "VOTE_PHASE_REQUIRES_VOTE"}
                target_id = action.get("target_id")
                if target_id == agent.id:
                    return {"success": False, "error": "CANNOT_VOTE_SELF"}
                if phase == "revote":
                    candidates = ms.get("revote_candidates") or []
                    if target_id not in candidates:
                        return {"success": False, "error": "TARGET_MUST_BE_REVOTE_CANDIDATE"}
                elif target_id not in agents:
                    return {"success": False, "error": "INVALID_TARGET"}
                ms.setdefault("pending_actions", {})[agent.id] = {"type": "vote", "target_id": target_id}
            else:
                return {"success": False, "error": f"NO_ACTION_IN_PHASE_{phase}"}

            self._commit(ms)
            self._broadcast_mafia_state()

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

        if phase == "hint":
            history_entry = {"phase": "hint", "hints": []}
            for aid, act in pending.items():
                ag = self.db.query(Agent).filter_by(id=aid).first()
                history_entry["hints"].append({
                    "agent_id": aid,
                    "name": ag.name if ag else aid,
                    "text": act.get("text", ""),
                })
            ms.setdefault("history", []).append(history_entry)
            ms["pending_actions"] = {}
            ms["phase"] = "suspect"
            ms["phase_started_at"] = time.time()
            self._commit(ms)
            self._broadcast_mafia_state()
            return

        if phase == "suspect":
            history_entry = {"phase": "suspect", "suspects": []}
            for aid, act in pending.items():
                ag = self.db.query(Agent).filter_by(id=aid).first()
                target_ag = self.db.query(Agent).filter_by(id=act.get("target_id", "")).first()
                history_entry["suspects"].append({
                    "agent_id": aid,
                    "name": ag.name if ag else aid,
                    "target_id": act.get("target_id"),
                    "target_name": target_ag.name if target_ag else act.get("target_id"),
                    "reason_code": act.get("reason_code", "ETC"),
                })
            ms.setdefault("history", []).append(history_entry)
            ms["pending_actions"] = {}
            ms["phase"] = "final"
            ms["phase_started_at"] = time.time()
            self._commit(ms)
            self._broadcast_mafia_state()
            return

        if phase == "final":
            history_entry = {"phase": "final", "statements": []}
            for aid, act in pending.items():
                ag = self.db.query(Agent).filter_by(id=aid).first()
                history_entry["statements"].append({
                    "agent_id": aid,
                    "name": ag.name if ag else aid,
                    "text": act.get("text", ""),
                })
            ms.setdefault("history", []).append(history_entry)
            ms["pending_actions"] = {}
            ms["phase"] = "vote"
            ms["phase_started_at"] = time.time()
            self._commit(ms)
            self._broadcast_mafia_state()
            return

        if phase in ("vote", "revote"):
            votes = [p.get("target_id") for p in pending.values() if p.get("type") == "vote" and p.get("target_id")]
            from collections import Counter
            count = Counter(votes)
            vote_detail = [{"voter_id": aid, "target_id": p.get("target_id")} for aid, p in pending.items()]

            if not count:
                eliminated_id = list(agents.keys())[0]
                eliminated_role = agents.get(eliminated_id, {}).get("role", "CITIZEN")
                winner = "CITIZEN" if eliminated_role == "WOLF" else "WOLF"
                self._finish_vote(ms, vote_detail, eliminated_id, eliminated_role, winner)
                return

            max_votes = max(count.values())
            candidates = [tid for tid, c in count.items() if c == max_votes]

            if len(candidates) == 1:
                eliminated_id = candidates[0]
                eliminated_role = agents.get(eliminated_id, {}).get("role", "CITIZEN")
                winner = "CITIZEN" if eliminated_role == "WOLF" else "WOLF"
                self._finish_vote(ms, vote_detail, eliminated_id, eliminated_role, winner)
                return

            if phase == "revote":
                eliminated_id = random.choice(candidates)
                eliminated_role = agents.get(eliminated_id, {}).get("role", "CITIZEN")
                winner = "CITIZEN" if eliminated_role == "WOLF" else "WOLF"
                ms.setdefault("history", []).append({
                    "phase": "tiebreak",
                    "candidates": candidates,
                    "eliminated_id": eliminated_id,
                    "message": "Random eliminated",
                })
                self._finish_vote(ms, vote_detail, eliminated_id, eliminated_role, winner)
                return

            ms["phase"] = "revote"
            ms["revote_round"] = 1
            ms["revote_candidates"] = candidates
            ms["pending_actions"] = {}
            ms.setdefault("history", []).append({
                "phase": "revote_start",
                "candidates": candidates,
            })
            ms["phase_started_at"] = time.time()
            self._commit(ms)
            self._broadcast_mafia_state()
            return

        self._commit(ms)

    def _finish_vote(self, ms: dict, vote_detail: list, eliminated_id: str, eliminated_role: str, winner: str):
        ms["phase"] = "result"
        ms["eliminated_id"] = eliminated_id
        ms["eliminated_role"] = eliminated_role
        ms["winner"] = winner
        ms["vote_detail"] = vote_detail
        ms["pending_actions"] = {}
        ms["revote_candidates"] = []
        ms.setdefault("history", []).append({
            "phase": "vote_result",
            "vote_detail": vote_detail,
            "eliminated_id": eliminated_id,
            "eliminated_role": eliminated_role,
            "winner": winner,
            "common_word": ms.get("common_word"),
            "odd_word": ms.get("odd_word"),
            "agents": [
                {"agent_id": aid, "role": info.get("role"), "secret_word": info.get("secret_word")}
                for aid, info in (ms.get("agents") or {}).items()
            ],
        })
        self._commit(ms)
        self._broadcast_mafia_state()
        self.finish()

    def _phase_timeout_sec(self) -> int:
        return (self.game.config or {}).get("phase_timeout_seconds", 60)

    def default_action(self, agent_id: str) -> dict:
        self.db.refresh(self.game)
        ms = self._ms()
        phase = ms.get("phase", "waiting")
        agents = ms.get("agents", {})
        others = [aid for aid in agents if aid != agent_id]
        target_id = random.choice(others) if others else agent_id

        if phase == "hint":
            return {"type": "hint", "text": "제 단어가 뭐였죠?"}
        if phase == "suspect":
            return {"type": "suspect", "target_id": target_id, "reason_code": "ETC"}
        if phase == "final":
            base = "저는 시민입니다. "
            text = (base * 10)[:MAX_FINAL_MAX]
            if len(text) < MAX_FINAL_MIN:
                text = text.ljust(MAX_FINAL_MIN, ".")
            return {"type": "final", "text": text}
        if phase in ("vote", "revote"):
            if phase == "revote":
                candidates = ms.get("revote_candidates") or []
                target_id = random.choice(candidates) if candidates else target_id
            return {"type": "vote", "target_id": target_id}
        return {"type": "hint", "text": ""}

    def apply_phase_timeout(self) -> bool:
        if self.game.status != GameStatus.running:
            return False
        lock = _get_action_lock(self.game.id)
        with lock:
            self.db.refresh(self.game)
            ms = self._ms()
            phase = ms.get("phase", "waiting")
            if phase not in ACTION_PHASES:
                return False
            agents = ms.get("agents", {})
            pending = ms.get("pending_actions", {})
            if len(pending) >= len(agents):
                return False
            started = ms.get("phase_started_at") or 0
            if time.time() - started < self._phase_timeout_sec():
                return False
            missing = [aid for aid in agents if aid not in pending]
            for aid in missing:
                pending[aid] = self.default_action(aid)
            _logger.info("mafia phase timeout game_id=%s phase=%s 미제출 처리 agent_ids=%s", self.game.id, phase, missing)
            self._commit(ms)
            if len(pending) >= len(agents):
                self._advance_phase()
            return len(missing) > 0

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
        if phase == "hint":
            allowed = ["hint"]
        elif phase == "suspect":
            allowed = ["suspect"]
        elif phase == "final":
            allowed = ["final"]
        elif phase in ("vote", "revote"):
            allowed = ["vote"]

        pending = ms.get("pending_actions", {})
        submitted = len(pending)
        total = len(agents) if agents else len(participants)
        self_submitted = agent.id in pending

        secret_word = _fix_word_encoding(ag.get("secret_word", "") or "")
        if phase in ("result", "end"):
            visible_role = ag.get("role", "CITIZEN")
        else:
            visible_role = "UNKNOWN"

        round_map = {"hint": 1, "suspect": 2, "final": 3, "vote": 4, "revote": 4, "result": 5, "end": 5}
        round_num = round_map.get(phase, 1)

        return {
            "gameStatus": self.game.status.value,
            "gameType": "mafia",
            "phase": phase,
            "round": round_num,
            "self": {
                "id": agent.id,
                "name": agent.name,
                "role": visible_role,
                "secretWord": secret_word,
            },
            "participants": participant_list,
            "history": ms.get("history", []),
            "allowed_actions": allowed,
            "phase_submissions": {"submitted": submitted, "total": total},
            "self_submitted": self_submitted,
            "revote_candidates": ms.get("revote_candidates", []),
            "result": self._get_result(agent.id, ms) if phase in ("result", "end") else None,
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
            "citizen_word": _fix_word_encoding(ms.get("common_word") or ms.get("citizen_word") or ""),
            "wolf_word": _fix_word_encoding(ms.get("odd_word") or ms.get("wolf_word") or ""),
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
