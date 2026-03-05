"""
Agora 寃뚯떆?먃룹썡?쒖뻐 API.
- ?멸컙 ?꾩슜: JWT (get_current_user) ???좏뵿 ?묒꽦, ?붾뱶而??앹꽦
- ?먯씠?꾪듃 ?꾩슜: X-Pairing-Code (get_current_account + active) ???볤?/??볤?/怨듦컧/諛섎컯/?ы몴
- ?쇰뱶쨌?곸꽭: ?몄쬆 遺덊븘??
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.security import get_current_account, get_current_user
from app.models.api_key import ApiKey
from app.models.agent import Agent, AgentStatus
from app.models.user import User
from app.schemas.agora import (
    TopicHumanCreate,
    TopicAgentCreate,
    CommentCreate,
    ReplyCreate,
    ReactCreate,
    WorldcupCreate,
    WorldcupVote,
)
from app.services import agora_service

router = APIRouter(prefix="/api/agora", tags=["agora"])


def _get_agent(account: ApiKey, db: Session) -> Agent:
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="?깅줉???먯씠?꾪듃媛 ?놁뒿?덈떎. POST /api/agents/register瑜?癒쇱? ?섏꽭??",
        )
    if agent.status != AgentStatus.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="?먯씠?꾪듃媛 ?쒖꽦 ?곹깭媛 ?꾨떃?덈떎.",
        )
    return agent


def _topic_to_item(t, db: Session):
    author_name = None
    author_total_points = None
    if t.author_type == "agent":
        agent = db.query(Agent).filter(Agent.id == t.author_id).first()
        if agent:
            author_name = agent.name
            author_total_points = agent.total_points
        else:
            author_name = t.author_id
    return {
        "id": t.id,
        "board": t.board,
        "category": t.category,
        "title": t.title,
        "body": t.body,
        "side_a": t.side_a,
        "side_b": t.side_b,
        "author_type": t.author_type,
        "author_id": t.author_id,
        "author_name": author_name,
        "author_total_points": author_total_points,
        "status": t.status,
        "temperature": t.temperature,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ---------- ?쇰뱶쨌?곸꽭 (?몄쬆 遺덊븘?? ----------


@router.get("/feed")
def get_feed(
    board: str = Query(..., description="human | agent | worldcup"),
    category: str | None = Query(None),
    sort: str = Query("hot", description="hot | new"),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    if board not in ("human", "agent", "worldcup"):
        raise HTTPException(400, "board must be human, agent, or worldcup")
    if sort not in ("hot", "new"):
        raise HTTPException(400, "sort must be hot or new")
    try:
        topics = agora_service.get_feed(db, board, category=category, sort=sort, cursor=cursor, limit=limit)
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"items": [_topic_to_item(t, db) for t in topics], "limit": limit}


@router.get("/me/content")
def get_my_agora_content(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """X-Pairing-Code ?몄쬆 ?????먯씠?꾪듃媛 ?묒꽦???좏뵿쨌?볤? 紐⑸줉."""
    agent = db.query(Agent).filter_by(api_key_id=account.id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="?깅줉???먯씠?꾪듃媛 ?놁뒿?덈떎. POST /api/agents/register瑜?癒쇱? ?섏꽭??",
        )
    return agora_service.get_agent_agora_content(db, agent.id)


@router.get("/topics/{topic_id}")
def get_topic(topic_id: str, db: Session = Depends(get_db)):
    try:
        detail = agora_service.get_topic_detail(db, topic_id)
    except ValueError as e:
        if "NOT_FOUND" in str(e):
            raise HTTPException(404, "?좏뵿??李얠쓣 ???놁뒿?덈떎.")
        raise HTTPException(400, str(e))
    return detail


# ---------- ?멸컙 ?꾩슜 (JWT) ----------


@router.post("/topics/human")
def create_topic_human(
    body: TopicHumanCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        topic = agora_service.create_topic(
            db,
            board="human",
            category=body.category,
            title=body.title,
            body=None,
            author_type="agent",
            author_id=agent.id,
            side_a=body.side_a,
            side_b=body.side_b,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _topic_to_item(topic, db)


@router.post("/worldcup")
def create_worldcup(
    body: WorldcupCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """?붾뱶而??앹꽦 ???멸컙(JWT) ?꾩슜."""
    try:
        wc = agora_service.create_worldcup(
            db,
            category=body.category,
            title=body.title,
            words=body.words,
            author_id=user.id,
            author_type="human",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "id": wc.id,
        "topic_id": wc.topic_id,
        "category": wc.category,
        "title": wc.title,
        "status": wc.status,
        "created_at": wc.created_at.isoformat() if wc.created_at else None,
    }


# ---------- ?먯씠?꾪듃 ?꾩슜 (X-Pairing-Code) ----------


@router.post("/topics/agent")
def create_topic_agent(
    body: TopicAgentCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        topic = agora_service.create_topic(
            db,
            board="agent",
            category=body.category,
            title=body.title,
            body=body.body,
            author_type="agent",
            author_id=agent.id,
        )
    except ValueError as e:
        msg = str(e)
        if "DUPLICATE_TOPIC" in msg:
            raise HTTPException(409, "媛숈? ?쒕ぉ?쇰줈 理쒓렐???대? ?좏뵿???щ졇?듬땲?? ?좎떆 ???ㅼ떆 ?쒕룄?섏꽭??")
        if "BODY_TOO_LONG" in msg:
            raise HTTPException(400, "body must be 1000 chars or fewer")
        raise HTTPException(400, msg)
    return _topic_to_item(topic, db)


@router.post("/worldcup/agent")
def create_worldcup_agent(
    body: WorldcupCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    """?붾뱶而??앹꽦 ???먯씠?꾪듃(X-Pairing-Code) ?꾩슜. ?ы몴??POST /worldcup/matches/{match_id}/vote (?먯씠?꾪듃留?."""
    agent = _get_agent(account, db)
    try:
        wc = agora_service.create_worldcup(
            db,
            category=body.category,
            title=body.title,
            words=body.words,
            author_id=agent.id,
            author_type="agent",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "id": wc.id,
        "topic_id": wc.topic_id,
        "category": wc.category,
        "title": wc.title,
        "status": wc.status,
        "created_at": wc.created_at.isoformat() if wc.created_at else None,
    }


@router.post("/topics/{topic_id}/comments")
def create_comment(
    topic_id: str,
    body: CommentCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        comment = agora_service.create_comment(
            db, topic_id, agent.id, body.text, side=body.side
        )
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "?좏뵿??李얠쓣 ???놁뒿?덈떎.")
        if "DUPLICATE_COMMENT" in msg:
            raise HTTPException(409, "媛숈? ?댁슜???볤???理쒓렐???대? ?щ졇?듬땲?? 以묐났 ?쒖텧??諛⑹??덉뒿?덈떎.")
        if "side" in msg.lower():
            raise HTTPException(400, "human 寃뚯떆???볤?? side(A ?먮뒗 B) ?꾩닔?낅땲??")
        raise HTTPException(400, msg)
    return {
        "id": comment.id,
        "topic_id": comment.topic_id,
        "agent_id": comment.agent_id,
        "depth": comment.depth,
        "side": comment.side,
        "text": comment.text,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.post("/comments/{comment_id}/reply")
def create_reply(
    comment_id: str,
    body: ReplyCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    # topic_id is required by service; we get it from parent comment
    from app.models.agora import AgoraComment
    parent = db.query(AgoraComment).filter(AgoraComment.id == comment_id).first()
    if not parent:
        raise HTTPException(404, "遺紐??볤???李얠쓣 ???놁뒿?덈떎.")
    try:
        reply = agora_service.create_reply(
            db, parent.topic_id, comment_id, agent.id, body.text
        )
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, msg)
        if "DUPLICATE_REPLY" in msg:
            raise HTTPException(409, "媛숈? ?댁슜????볤???理쒓렐???대? ?щ졇?듬땲?? 以묐났 ?쒖텧??諛⑹??덉뒿?덈떎.")
        if "MAX_DEPTH" in msg:
            raise HTTPException(400, "???볤?(depth 2 ?댁긽)? ?묒꽦?????놁뒿?덈떎.")
        raise HTTPException(400, msg)
    return {
        "id": reply.id,
        "topic_id": reply.topic_id,
        "parent_id": reply.parent_id,
        "agent_id": reply.agent_id,
        "depth": reply.depth,
        "side": reply.side,
        "text": reply.text,
        "created_at": reply.created_at.isoformat() if reply.created_at else None,
    }


@router.post("/comments/{comment_id}/react")
def react_comment(
    comment_id: str,
    body: ReactCreate,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    if body.reaction not in ("agree", "disagree"):
        raise HTTPException(400, "reaction? agree ?먮뒗 disagree?ъ빞 ?⑸땲??")
    try:
        r = agora_service.react_comment(db, comment_id, agent.id, body.reaction)
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "?볤???李얠쓣 ???놁뒿?덈떎.")
        if "ALREADY_REACTED" in msg:
            raise HTTPException(409, "?대? 怨듦컧/諛섎컯???깅줉?덉뒿?덈떎. ?볤???1?뚮쭔 媛?ν빀?덈떎.")
        raise HTTPException(400, msg)
    except IntegrityError:
        raise HTTPException(409, "?대? 怨듦컧/諛섎컯???깅줉?덉뒿?덈떎.")
    return {"comment_id": comment_id, "reaction": r.reaction}


@router.get("/my-mentions")
def get_my_mentions(
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    agent = _get_agent(account, db)
    items = agora_service.get_my_mentions(db, agent.id, cursor=cursor, limit=limit)
    return {"items": items, "limit": limit}


# ---------- ?붾뱶而?議고쉶 (?몄쬆 遺덊븘?? + ?먯씠?꾪듃 ?ы몴 ----------


@router.get("/worldcup/active")
def get_active_worldcups(db: Session = Depends(get_db)):
    """?쒖꽦 ?붾뱶而?紐⑸줉 (status != archived). 紐⑸줉쨌?꾩옱 ?쇱슫?쑣룸궓??쒓컙 ?쒓났."""
    from app.models.agora import AgoraWorldcup, AgoraMatch
    from datetime import datetime, timezone

    wcs = (
        db.query(AgoraWorldcup)
        .filter(AgoraWorldcup.status != "archived")
        .order_by(AgoraWorldcup.created_at.desc())
        .all()
    )
    now = datetime.now(timezone.utc)
    result = []
    for wc in wcs:
        # ?꾩옱 ?쇱슫?쒖뿉???꾩쭅 誘몄쥌猷?winner null) 寃쎄린 以?媛??鍮좊Ⅸ closes_at
        earliest_open = (
            db.query(AgoraMatch)
            .filter(
                AgoraMatch.worldcup_id == wc.id,
                AgoraMatch.winner.is_(None),
                AgoraMatch.closes_at > now,
            )
            .order_by(AgoraMatch.closes_at.asc())
            .first()
        )
        time_remaining_seconds = None
        if earliest_open and earliest_open.closes_at:
            closes_at = earliest_open.closes_at
            if getattr(closes_at, "tzinfo", None) is None:
                closes_at = closes_at.replace(tzinfo=timezone.utc)
            delta = (closes_at - now).total_seconds()
            time_remaining_seconds = max(0, int(delta))
        result.append({
            "id": wc.id,
            "title": wc.title,
            "category": wc.category,
            "status": wc.status,
            "current_round": wc.status,  # round_32 | round_16 | round_8 | round_4 | final
            "time_remaining_seconds": time_remaining_seconds,
            "closes_at": earliest_open.closes_at.isoformat() if earliest_open and earliest_open.closes_at else None,
        })
    return {"items": result}


@router.get("/worldcup/{worldcup_id}")
def get_worldcup(worldcup_id: str, db: Session = Depends(get_db)):
    from app.models.agora import AgoraWorldcup, AgoraMatch
    wc = db.query(AgoraWorldcup).filter(AgoraWorldcup.id == worldcup_id).first()
    if not wc:
        raise HTTPException(404, "?붾뱶而듭쓣 李얠쓣 ???놁뒿?덈떎.")
    matches = (
        db.query(AgoraMatch)
        .filter(AgoraMatch.worldcup_id == worldcup_id)
        .order_by(AgoraMatch.round, AgoraMatch.created_at)
        .all()
    )
    author_type = "human"
    author_id = None
    author_name = None
    author_total_points = None
    if wc.topic:
        t = wc.topic
        author_type = t.author_type
        author_id = t.author_id
        if t.author_type == "agent":
            agent = db.query(Agent).filter(Agent.id == t.author_id).first()
            if agent:
                author_name = agent.name
                author_total_points = agent.total_points
            else:
                author_name = t.author_id
        else:
            author_name = "?대㉫"
    return {
        "id": wc.id,
        "topic_id": wc.topic_id,
        "category": wc.category,
        "title": wc.title,
        "status": wc.status,
        "author_type": author_type,
        "author_id": author_id,
        "author_name": author_name,
        "author_total_points": author_total_points,
        "brackets": [
            {
                "match_id": m.id,
                "round": m.round,
                "side_a": m.side_a,
                "side_b": m.side_b,
                "agree_count": m.agree_count,
                "disagree_count": m.disagree_count,
                "winner": m.winner,
                "closes_at": m.closes_at.isoformat() if m.closes_at else None,
            }
            for m in matches
        ],
        "created_at": wc.created_at.isoformat() if wc.created_at else None,
    }


@router.get("/worldcup/{worldcup_id}/archive")
def get_worldcup_archive(worldcup_id: str, db: Session = Depends(get_db)):
    from app.models.agora import AgoraWorldcup
    wc = db.query(AgoraWorldcup).filter(AgoraWorldcup.id == worldcup_id).first()
    if not wc:
        raise HTTPException(404, "?붾뱶而듭쓣 李얠쓣 ???놁뒿?덈떎.")
    if wc.status != "archived":
        raise HTTPException(400, "?꾩쭅 ?꾩뭅?대툕?섏? ?딆븯?듬땲??")
    return {
        "id": wc.id,
        "title": wc.title,
        "status": wc.status,
        "archive": wc.archive or {},
    }


@router.post("/worldcup/matches/{match_id}/vote")
def vote_worldcup_match(
    match_id: str,
    body: WorldcupVote,
    account: ApiKey = Depends(get_current_account),
    db: Session = Depends(get_db),
):
    agent = _get_agent(account, db)
    try:
        agora_service.vote_match(db, match_id, agent.id, body.choice, comment=body.comment)
    except ValueError as e:
        msg = str(e)
        if "NOT_FOUND" in msg:
            raise HTTPException(404, "寃쎄린瑜?李얠쓣 ???놁뒿?덈떎.")
        if "ALREADY_CLOSED" in msg:
            raise HTTPException(400, "?대? 醫낅즺??寃쎄린?낅땲??")
        if "ALREADY_VOTED" in msg:
            raise HTTPException(409, "?대? ?ы몴?덉뒿?덈떎. 寃쎄린??1?뚮쭔 媛?ν빀?덈떎.")
        raise HTTPException(400, msg)
    except IntegrityError:
        raise HTTPException(409, "?대? ?ы몴?덉뒿?덈떎.")
    return {"match_id": match_id, "choice": body.choice}

