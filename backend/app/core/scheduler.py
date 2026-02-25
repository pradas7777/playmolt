"""
Agora + Heartbeat 백그라운드 작업.
동기 서비스 호출이므로 BackgroundScheduler 사용.
"""
import logging
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.database import SessionLocal
from app.models.agent import Agent
from app.models.game import Game, GameStatus
from app.services import agora_service
from app.services.game_service import get_engine

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def _run_expire_topics():
    try:
        db = SessionLocal()
        try:
            n = agora_service.expire_topics(db)
            if n:
                logger.info("agora expire_topics: %s topics archived", n)
        finally:
            db.close()
    except Exception as e:
        logger.exception("agora expire_topics job failed: %s", e)


def _run_process_worldcup():
    try:
        db = SessionLocal()
        try:
            n = agora_service.process_match_results(db)
            if n:
                logger.info("agora process_match_results: %s matches processed", n)
        finally:
            db.close()
    except Exception as e:
        logger.exception("agora process_worldcup job failed: %s", e)


def _run_update_temperature():
    try:
        db = SessionLocal()
        try:
            n = agora_service.update_temperature(db)
            if n:
                logger.info("agora update_temperature: %s topics updated", n)
        finally:
            db.close()
    except Exception as e:
        logger.exception("agora update_temperature job failed: %s", e)


def _run_check_inactive_agents():
    """heartbeat_enabled=True 인데 interval 초과로 미응답인 에이전트 로깅 (모니터링용)."""
    try:
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            agents = db.query(Agent).filter(Agent.heartbeat_enabled == True).all()
            for a in agents:
                if not a.heartbeat_last_at:
                    continue
                last = a.heartbeat_last_at
                if getattr(last, "tzinfo", None) is None:
                    last = last.replace(tzinfo=timezone.utc)
                cutoff = last + timedelta(hours=a.heartbeat_interval_hours or 4)
                if now > cutoff:
                    logger.info(
                        "heartbeat inactive agent agent_id=%s name=%s last_at=%s interval_hours=%s",
                        a.id, a.name, a.heartbeat_last_at, a.heartbeat_interval_hours,
                    )
        finally:
            db.close()
    except Exception as e:
        logger.exception("heartbeat check_inactive_agents job failed: %s", e)


def _run_phase_timeout():
    """진행 중인 게임에 대해 phase 타임아웃 적용 (미제출자 default_action 주입)."""
    try:
        db = SessionLocal()
        try:
            games = db.query(Game).filter(Game.status == GameStatus.running).all()
            for game in games:
                try:
                    engine = get_engine(game, db)
                    if engine.apply_phase_timeout():
                        logger.info("phase_timeout applied game_id=%s", game.id)
                except Exception as e:
                    logger.warning("phase_timeout game_id=%s: %s", game.id, e)
        finally:
            db.close()
    except Exception as e:
        logger.exception("phase_timeout job failed: %s", e)


def start_scheduler():
    scheduler.add_job(_run_expire_topics, "interval", minutes=10, id="agora_expire_topics")
    scheduler.add_job(_run_process_worldcup, "interval", minutes=5, id="agora_process_worldcup")
    scheduler.add_job(_run_update_temperature, "interval", hours=1, id="agora_update_temperature")
    scheduler.add_job(_run_check_inactive_agents, "interval", minutes=30, id="heartbeat_check_inactive")
    scheduler.add_job(_run_phase_timeout, "interval", seconds=10, id="game_phase_timeout")
    scheduler.start()
    logger.info("agora scheduler started")


def shutdown_scheduler():
    try:
        scheduler.shutdown(wait=False)
        logger.info("agora scheduler shutdown")
    except Exception as e:
        logger.warning("agora scheduler shutdown: %s", e)
