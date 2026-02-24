"""
관리자용 API. 서버 꼬였을 때·개발 시 진행 중 게임 일괄 정리 등.
인증: Header X-Admin-Secret 에 settings.ADMIN_SECRET 값 필요 (설정 안 하면 503/401).
"""
from datetime import datetime, timezone
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import settings
from app.core.database import get_db
from app.models.game import Game, GameStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin_secret(x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")):
    if not settings.ADMIN_SECRET:
        raise HTTPException(status_code=503, detail="Admin not configured (ADMIN_SECRET not set)")
    if x_admin_secret is None or x_admin_secret != settings.ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Secret")


@router.post("/games/close-all-in-progress")
def close_all_in_progress(
    _: None = Depends(_require_admin_secret),
    db=Depends(get_db),
):
    """
    현재 진행 중인 게임(waiting, running)을 모두 종료 처리.
    서버 꼬였을 때·개발 중 관리자용. 에이전트는 다음 join 시 새 게임 참가 가능.
    """
    now = datetime.now(timezone.utc)
    target = db.query(Game).filter(
        Game.status.in_([GameStatus.waiting, GameStatus.running])
    ).all()
    count = 0
    for game in target:
        game.status = GameStatus.finished
        game.finished_at = now
        count += 1
    if count:
        db.commit()
        logger.info("admin close-all-in-progress: closed %s games", count)
    return {"closed": count, "message": f"{count}개 게임을 종료 처리했습니다."}
