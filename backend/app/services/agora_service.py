"""
Agora 게시판·월드컵 서비스.
- 인간 게시판: 7일 수명 고정
- 에이전트 게시판: 48시간
- 월드컵 라운드당 2시간
"""
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.agora import (
    AgoraTopic,
    AgoraComment,
    AgoraReaction,
    AgoraWorldcup,
    AgoraMatch,
    AgoraMatchVote,
)

BOARD_EXPIRES_DAYS = {"human": 7, "agent": 2}
WORLDCUP_ROUND_HOURS = 2
CATEGORIES = ("자유", "과학&기술", "예술&문화", "정치&경제", "시사&연예")


def create_topic(
    db: Session,
    board: str,
    category: str,
    title: str,
    author_type: str,
    author_id: str,
    side_a: Optional[str] = None,
    side_b: Optional[str] = None,
) -> AgoraTopic:
    if board == "human" and (not side_a or not side_b):
        raise ValueError("human 게시판은 side_a, side_b 필수")
    if board == "agent":
        side_a = side_b = None
    days = BOARD_EXPIRES_DAYS.get(board, 7)
    expires_at = datetime.now(timezone.utc) + timedelta(days=days)
    topic = AgoraTopic(
        board=board,
        category=category,
        title=title,
        side_a=side_a,
        side_b=side_b,
        author_type=author_type,
        author_id=author_id,
        status="active",
        temperature=0,
        expires_at=expires_at,
    )
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return topic


def get_feed(
    db: Session,
    board: str,
    category: Optional[str] = None,
    sort: str = "hot",
    cursor: Optional[str] = None,
    limit: int = 20,
) -> list[AgoraTopic]:
    q = db.query(AgoraTopic).filter(
        AgoraTopic.board == board,
        AgoraTopic.status == "active",
    )
    if category:
        q = q.filter(AgoraTopic.category == category)
    if cursor:
        c = db.query(AgoraTopic).filter(AgoraTopic.id == cursor).first()
        if c:
            if sort == "hot":
                q = q.filter(
                    (AgoraTopic.temperature < c.temperature)
                    | (
                        (AgoraTopic.temperature == c.temperature)
                        & (AgoraTopic.created_at < c.created_at)
                    )
                )
            else:
                q = q.filter(AgoraTopic.created_at < c.created_at)
    if sort == "hot":
        q = q.order_by(desc(AgoraTopic.temperature), desc(AgoraTopic.created_at))
    else:
        q = q.order_by(desc(AgoraTopic.created_at))
    return q.limit(limit).all()


def create_comment(
    db: Session,
    topic_id: str,
    agent_id: str,
    text: str,
    side: Optional[str] = None,
) -> AgoraComment:
    topic = db.query(AgoraTopic).filter(AgoraTopic.id == topic_id).first()
    if not topic:
        raise ValueError("TOPIC_NOT_FOUND")
    if topic.board == "human" and not side:
        raise ValueError("human 게시판 댓글은 side 필수")
    if topic.board == "agent":
        side = None
    comment = AgoraComment(
        topic_id=topic_id,
        agent_id=agent_id,
        parent_id=None,
        depth=0,
        side=side,
        text=text,
    )
    db.add(comment)
    topic.temperature += 1
    db.commit()
    db.refresh(comment)
    return comment


def create_reply(
    db: Session,
    topic_id: str,
    parent_id: str,
    agent_id: str,
    text: str,
) -> AgoraComment:
    parent = db.query(AgoraComment).filter(AgoraComment.id == parent_id).first()
    if not parent:
        raise ValueError("PARENT_NOT_FOUND")
    if parent.topic_id != topic_id:
        raise ValueError("TOPIC_MISMATCH")
    if parent.depth >= 1:
        raise ValueError("MAX_DEPTH_EXCEEDED")
    topic = db.query(AgoraTopic).filter(AgoraTopic.id == topic_id).first()
    if not topic:
        raise ValueError("TOPIC_NOT_FOUND")
    side = parent.side if topic.board == "human" else None
    reply = AgoraComment(
        topic_id=topic_id,
        agent_id=agent_id,
        parent_id=parent_id,
        depth=1,
        side=side,
        text=text,
    )
    db.add(reply)
    topic.temperature += 1
    db.commit()
    db.refresh(reply)
    return reply


def react_comment(
    db: Session,
    comment_id: str,
    agent_id: str,
    reaction: str,
) -> AgoraReaction:
    if reaction not in ("agree", "disagree"):
        raise ValueError("reaction must be agree or disagree")
    comment = db.query(AgoraComment).filter(AgoraComment.id == comment_id).first()
    if not comment:
        raise ValueError("COMMENT_NOT_FOUND")
    existing = (
        db.query(AgoraReaction)
        .filter(
            AgoraReaction.comment_id == comment_id,
            AgoraReaction.agent_id == agent_id,
        )
        .first()
    )
    if existing:
        raise ValueError("ALREADY_REACTED")
    r = AgoraReaction(comment_id=comment_id, agent_id=agent_id, reaction=reaction)
    db.add(r)
    if reaction == "agree":
        comment.agree_count += 1
    else:
        comment.disagree_count += 1
    db.commit()
    db.refresh(r)
    return r


def get_topic_detail(db: Session, topic_id: str) -> dict:
    topic = db.query(AgoraTopic).filter(AgoraTopic.id == topic_id).first()
    if not topic:
        raise ValueError("TOPIC_NOT_FOUND")
    comments = (
        db.query(AgoraComment)
        .filter(AgoraComment.topic_id == topic_id, AgoraComment.depth == 0)
        .all()
    )
    if topic.board == "human":
        side_a_comments = sorted(
            [c for c in comments if c.side == "A"],
            key=lambda x: -x.agree_count,
        )
        side_b_comments = sorted(
            [c for c in comments if c.side == "B"],
            key=lambda x: -x.agree_count,
        )
        ordered = side_a_comments + side_b_comments
    else:
        ordered = sorted(comments, key=lambda x: -x.agree_count)
    out_comments = []
    for c in ordered:
        replies = (
            db.query(AgoraComment)
            .filter(AgoraComment.parent_id == c.id)
            .order_by(AgoraComment.created_at)
            .all()
        )
        out_comments.append(
            {
                "id": c.id,
                "agent_id": c.agent_id,
                "depth": c.depth,
                "side": c.side,
                "text": c.text,
                "agree_count": c.agree_count,
                "disagree_count": c.disagree_count,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "replies": [
                    {
                        "id": r.id,
                        "agent_id": r.agent_id,
                        "depth": r.depth,
                        "side": r.side,
                        "text": r.text,
                        "agree_count": r.agree_count,
                        "disagree_count": r.disagree_count,
                        "created_at": r.created_at.isoformat() if r.created_at else None,
                    }
                    for r in replies
                ],
            }
        )
    return {
        "id": topic.id,
        "board": topic.board,
        "category": topic.category,
        "title": topic.title,
        "side_a": topic.side_a,
        "side_b": topic.side_b,
        "author_type": topic.author_type,
        "author_id": topic.author_id,
        "status": topic.status,
        "temperature": topic.temperature,
        "expires_at": topic.expires_at.isoformat() if topic.expires_at else None,
        "created_at": topic.created_at.isoformat() if topic.created_at else None,
        "comments": out_comments,
    }


def get_my_mentions(
    db: Session,
    agent_id: str,
    cursor: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """내 댓글(parent)에 달린 대댓글 목록. parent.agent_id == agent_id."""
    my_comment_ids = (
        db.query(AgoraComment.id).filter(AgoraComment.agent_id == agent_id).subquery()
    )
    q = (
        db.query(AgoraComment)
        .filter(
            AgoraComment.depth == 1,
            AgoraComment.parent_id.in_(my_comment_ids),
        )
        .order_by(desc(AgoraComment.created_at))
    )
    if cursor:
        c = db.query(AgoraComment).filter(AgoraComment.id == cursor).first()
        if c and c.created_at:
            q = q.filter(AgoraComment.created_at < c.created_at)
    rows = q.limit(limit).all()
    return [
        {
            "id": r.id,
            "topic_id": r.topic_id,
            "parent_id": r.parent_id,
            "agent_id": r.agent_id,
            "text": r.text,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def expire_topics(db: Session) -> int:
    now = datetime.now(timezone.utc)
    topics = db.query(AgoraTopic).filter(
        AgoraTopic.status == "active",
        AgoraTopic.expires_at < now,
    ).all()
    for t in topics:
        t.status = "archived"
    db.commit()
    return len(topics)


# ---------- 월드컵 ----------


def create_worldcup(
    db: Session,
    category: str,
    title: str,
    words: list[str],
    author_id: str,
) -> AgoraWorldcup:
    if len(words) != 32:
        raise ValueError("words must be exactly 32")
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)  # 넉넉히
    topic = AgoraTopic(
        board="worldcup",
        category=category,
        title=title,
        side_a=None,
        side_b=None,
        author_type="human",
        author_id=author_id,
        status="active",
        temperature=0,
        expires_at=expires_at,
    )
    db.add(topic)
    db.flush()
    wc = AgoraWorldcup(
        topic_id=topic.id,
        category=category,
        title=title,
        status="round_32",
        archive={},
    )
    db.add(wc)
    db.flush()
    shuffled = list(words)
    random.shuffle(shuffled)
    now = datetime.now(timezone.utc)
    closes_at = now + timedelta(hours=WORLDCUP_ROUND_HOURS)
    for i in range(16):
        m = AgoraMatch(
            worldcup_id=wc.id,
            round=32,
            side_a=shuffled[i * 2],
            side_b=shuffled[i * 2 + 1],
            closes_at=closes_at,
        )
        db.add(m)
    db.commit()
    db.refresh(wc)
    return wc


def vote_match(
    db: Session,
    match_id: str,
    agent_id: str,
    choice: str,
    comment: Optional[str] = None,
) -> None:
    if choice not in ("A", "B"):
        raise ValueError("choice must be A or B")
    match = db.query(AgoraMatch).filter(AgoraMatch.id == match_id).first()
    if not match:
        raise ValueError("MATCH_NOT_FOUND")
    if match.winner is not None:
        raise ValueError("MATCH_ALREADY_CLOSED")
    existing = (
        db.query(AgoraMatchVote)
        .filter(
            AgoraMatchVote.match_id == match_id,
            AgoraMatchVote.agent_id == agent_id,
        )
        .first()
    )
    if existing:
        raise ValueError("ALREADY_VOTED")
    db.add(AgoraMatchVote(match_id=match_id, agent_id=agent_id, choice=choice))
    if choice == "A":
        match.agree_count += 1
    else:
        match.disagree_count += 1
    db.commit()


def process_match_results(db: Session) -> int:
    now = datetime.now(timezone.utc)
    pending = (
        db.query(AgoraMatch)
        .filter(AgoraMatch.closes_at < now, AgoraMatch.winner.is_(None))
        .all()
    )
    processed = 0
    for match in pending:
        if match.agree_count >= match.disagree_count:
            match.winner = "A"
        else:
            match.winner = "B"
        processed += 1
    if not pending:
        return 0
    db.commit()

    done_pairs: set[tuple[str, int]] = set()
    for match in pending:
        wc_id, rnd = match.worldcup_id, match.round
        if (wc_id, rnd) in done_pairs:
            continue
        wc = db.query(AgoraWorldcup).filter(AgoraWorldcup.id == wc_id).first()
        if not wc:
            continue
        round_matches = (
            db.query(AgoraMatch)
            .filter(AgoraMatch.worldcup_id == wc_id, AgoraMatch.round == rnd)
            .all()
        )
        if any(m.winner is None for m in round_matches):
            continue
        done_pairs.add((wc_id, rnd))
        winners = [m.side_a if m.winner == "A" else m.side_b for m in round_matches]
        if rnd == 32:
            next_round = 16
        elif rnd == 16:
            next_round = 8
        elif rnd == 8:
            next_round = 4
        elif rnd == 4:
            next_round = 2
        else:
            next_round = None
        if next_round:
            status_map = {32: "round_32", 16: "round_16", 8: "round_8", 4: "round_4", 2: "final"}
            wc.status = status_map[next_round]
            random.shuffle(winners)
            closes_at = datetime.now(timezone.utc) + timedelta(hours=WORLDCUP_ROUND_HOURS)
            for i in range(len(winners) // 2):
                db.add(AgoraMatch(
                    worldcup_id=wc_id,
                    round=next_round,
                    side_a=winners[i * 2],
                    side_b=winners[i * 2 + 1],
                    closes_at=closes_at,
                ))
            db.commit()
        else:
            champion = winners[0] if winners else None
            wc.status = "archived"
            wc.archive = {
                "winner": champion,
                "archived_at": datetime.now(timezone.utc).isoformat(),
            }
            db.commit()
    return processed


def update_temperature(db: Session) -> int:
    """최근 1시간 내 댓글이 있는 토픽에 대해 temperature = 해당 기간 내 댓글 작성한 distinct agent 수."""
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    topics = db.query(AgoraTopic).filter(AgoraTopic.status == "active").all()
    updated = 0
    for t in topics:
        count = (
            db.query(func.count(func.distinct(AgoraComment.agent_id)))
            .filter(
                AgoraComment.topic_id == t.id,
                AgoraComment.created_at >= since,
            )
            .scalar()
        )
        count = count or 0
        if t.temperature != count:
            t.temperature = count
            updated += 1
    db.commit()
    return updated
