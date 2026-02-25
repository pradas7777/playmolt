"""
Agora 백그라운드 작업: 토픽 만료 아카이브, 월드컵 경기 결과 처리, 온도 재계산.
동기 서비스 호출이므로 BackgroundScheduler 사용.
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler

from app.core.database import SessionLocal
from app.services import agora_service

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


def start_scheduler():
    scheduler.add_job(_run_expire_topics, "interval", minutes=10, id="agora_expire_topics")
    scheduler.add_job(_run_process_worldcup, "interval", minutes=5, id="agora_process_worldcup")
    scheduler.add_job(_run_update_temperature, "interval", hours=1, id="agora_update_temperature")
    scheduler.start()
    logger.info("agora scheduler started")


def shutdown_scheduler():
    try:
        scheduler.shutdown(wait=False)
        logger.info("agora scheduler shutdown")
    except Exception as e:
        logger.warning("agora scheduler shutdown: %s", e)
