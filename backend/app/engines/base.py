"""
engines/base.py
모든 게임 엔진이 상속하는 공통 인터페이스.
coin 규칙: 승점 1점=1coin, 비정상 종료 0점. mafia/trial 승패, battle/ox 1등 횟수 로그.
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session

from app.models.game import Game, GameParticipant, GameStatus, GameType
from app.models.agent import Agent
from app.models.point_log import PointLog


class BaseGameEngine(ABC):

    def __init__(self, game: Game, db: Session):
        self.game = game
        self.db = db

    # ── 하위 클래스가 반드시 구현 ──────────────────────

    @abstractmethod
    def process_action(self, agent: Agent, action: dict) -> dict:
        """
        행동 처리 후 결과 반환.
        반환: { "success": bool, "message": str, "data": dict }
        """
        pass

    @abstractmethod
    def get_state(self, agent: Agent) -> dict:
        """
        에이전트 시점의 현재 게임 상태 반환.
        LLM에게 전달되는 데이터이므로 간결하게.
        """
        pass

    @abstractmethod
    def check_game_end(self) -> bool:
        """게임 종료 조건 확인. 종료면 True."""
        pass

    @abstractmethod
    def calculate_results(self) -> list[dict]:
        """
        게임 종료 시 결과 계산.
        반환: [{ "agent_id": str, "rank": int, "points": int }]
        """
        pass

    @abstractmethod
    def default_action(self, agent_id: str) -> dict:
        """미응답(타임아웃) 시 자동 주입할 액션. process_action에 넣을 수 있는 형태."""
        pass

    def apply_phase_timeout(self) -> bool:
        """Phase 타임아웃 시 미제출 에이전트에 default_action 주입. 엔진별 구현. True면 1명 이상 주입함."""
        return False

    # ── 공통 로직 (모든 게임 동일) ─────────────────────

    def join(self, agent: Agent) -> dict:
        """게임 참가 공통 처리"""
        # 이미 참가 중인지 확인
        existing = self.db.query(GameParticipant).filter_by(
            game_id=self.game.id,
            agent_id=agent.id
        ).first()
        if existing:
            return {"success": False, "error": "ALREADY_JOINED"}

        # 정원 확인
        current = self.db.query(GameParticipant).filter_by(
            game_id=self.game.id
        ).count()
        max_agents = self.game.config.get("max_agents", 4)
        if current >= max_agents:
            return {"success": False, "error": "MAX_AGENTS_REACHED"}

        # 게임 대기 중인지 확인
        if self.game.status != GameStatus.waiting:
            return {"success": False, "error": "GAME_NOT_WAITING"}

        participant = GameParticipant(
            game_id=self.game.id,
            agent_id=agent.id,
        )
        self.db.add(participant)
        self.db.commit()

        # 정원 다 찼으면 게임 시작
        if current + 1 >= max_agents:
            self._start_game()

        return {"success": True, "game_id": self.game.id}

    def finish(self):
        """게임 종료 + 승점·승패·1등 로그 기록 (coin 규칙: 1점=1coin, 비정상 종료 시 0점)."""
        results = self.calculate_results()

        for result in results:
            # 참가 기록: 승패(win/lose) + 획득 포인트
            participant = self.db.query(GameParticipant).filter_by(
                game_id=self.game.id,
                agent_id=result["agent_id"]
            ).first()
            if participant:
                participant.result = "win" if result["rank"] == 1 else "lose"
                participant.points_earned = result["points"]

            # 포인트 로그 (승점 = coin)
            if result["points"] > 0:
                agent = self.db.query(Agent).filter_by(id=result["agent_id"]).first()
                if agent:
                    agent.total_points += result["points"]
                    log = PointLog(
                        agent_id=result["agent_id"],
                        game_id=self.game.id,
                        delta=result["points"],
                        reason=f"{self.game.type.value}_rank_{result['rank']}",
                    )
                    self.db.add(log)

            # battle / ox: 1등 횟수 로그 (AI 에이전트 조회용, delta=0으로 포인트 중복 없음)
            if result["rank"] == 1 and self.game.type in (GameType.battle, GameType.ox):
                self.db.add(PointLog(
                    agent_id=result["agent_id"],
                    game_id=self.game.id,
                    delta=0,
                    reason=f"{self.game.type.value}_first_place",
                ))

        # 게임 상태 업데이트
        self.game.status = GameStatus.finished
        self.game.finished_at = datetime.now(timezone.utc)
        self.db.commit()

        # 관전 WebSocket 브로드캐스트
        winner_id = results[0]["agent_id"] if results else None
        from app.core.connection_manager import manager
        manager.schedule_broadcast(
            self.game.id,
            {"type": "game_end", "winner_id": winner_id, "results": results},
        )

    def _start_game(self):
        """게임 시작 처리"""
        self.game.status = GameStatus.running
        self.game.started_at = datetime.now(timezone.utc)
        self.db.commit()

    def award_points(self, agent_id: str, points: int, reason: str):
        """포인트 즉시 지급 (게임 중간 지급용)"""
        agent = self.db.query(Agent).filter_by(id=agent_id).first()
        if agent and points != 0:
            agent.total_points += points
            log = PointLog(
                agent_id=agent_id,
                game_id=self.game.id,
                delta=points,
                reason=reason,
            )
            self.db.add(log)
            self.db.commit()
