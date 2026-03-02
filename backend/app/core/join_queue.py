"""
대기열(Queue) 기반 매칭.
join 시 대기열에 넣고, 게임별 필요 인원이 모이면 한 방을 만들어 동시 배정.

※ 대기열은 프로세스별 메모리(in-memory)입니다.
  uvicorn을 여러 워커로 띄우면 워커마다 큐가 따로 있어, 한 워커에서 대기 중인 에이전트와
  다른 워커로 들어온 에이전트는 매칭되지 않습니다. 외부 에이전트와 매칭하려면 단일 워커로 실행하세요.
"""
import threading
from typing import Any

QUEUE_WAIT_TIMEOUT_SEC = 300

# 게임별 필요 인원 (이 인원이 모여야 방 생성)
REQUIRED_COUNT: dict[str, int] = {
    "battle": 4,
    "mafia": 6,
    "ox": 5,
    "trial": 6,
}

_queues: dict[str, list[dict[str, Any]]] = {}
_queue_lock = threading.Lock()


def get_required_count(game_type: str) -> int:
    """게임 타입별 필요 인원. 알 수 없으면 4."""
    return REQUIRED_COUNT.get(game_type, 4)


def enqueue(game_type: str, agent_id: str) -> tuple[threading.Event, list, int]:
    """
    대기열에 추가.
    이미 같은 agent_id가 대기 중이면 새로 넣지 않고, 기존 항목의 event/result_holder를 반환
    (두 요청이 같은 대기를 공유해, 둘 다 game_id를 받음).
    반환: (event, result_holder, size_after_add).
    대기하려면 event.wait(timeout) 후 result_holder[0] 확인.
    """
    with _queue_lock:
        if game_type not in _queues:
            _queues[game_type] = []
        q = _queues[game_type]
        for e in q:
            if e["agent_id"] == agent_id:
                # 이미 대기 중 → 같은 event/result 공유 (중복 슬롯 없음, 둘 다 알림 받음)
                return e["event"], e["result"], len(q)
        event = threading.Event()
        result_holder = [None]
        _queues[game_type].append({
            "agent_id": agent_id,
            "event": event,
            "result": result_holder,
        })
        size = len(_queues[game_type])
    return event, result_holder, size


def pop_n(game_type: str, n: int) -> tuple[list[str], list[tuple[threading.Event, list]]] | None:
    """
    n명이 모였을 때만 호출. 대기열에서 n명을 꺼내
    (agent_id 리스트, [(event, result_holder), ...]) 반환.
    n명 미만이면 None.
    """
    with _queue_lock:
        q = _queues.get(game_type, [])
        if len(q) < n:
            return None
        popped = q[:n]
        _queues[game_type] = q[n:]
        if not _queues[game_type]:
            del _queues[game_type]
        agent_ids = [e["agent_id"] for e in popped]
        events_and_results = [(e["event"], e["result"]) for e in popped]
        return agent_ids, events_and_results


def pop_four(game_type: str) -> tuple[list[str], list[tuple[threading.Event, list]]] | None:
    """4명 꺼내기 (battle 호환)."""
    return pop_n(game_type, 4)


def put_back(
    game_type: str,
    agent_ids: list[str],
    events_and_results: list[tuple[threading.Event, list]],
) -> None:
    """
    pop_n으로 꺼낸 N명을 다시 대기열 앞에 넣음.
    서로 다른 N명이 아닐 때(중복 agent) 게임을 만들지 않고 대기시키기 위해 사용.
    """
    if len(agent_ids) != len(events_and_results):
        return
    with _queue_lock:
        if game_type not in _queues:
            _queues[game_type] = []
        entries = [
            {"agent_id": aid, "event": ev, "result": res}
            for aid, (ev, res) in zip(agent_ids, events_and_results)
        ]
        _queues[game_type] = entries + _queues[game_type]


def put_back_unique(
    game_type: str,
    agent_ids: list[str],
    events_and_results: list[tuple[threading.Event, list]],
) -> None:
    """
    중복 agent_id가 있을 때만 사용. agent_id당 첫 번째 항목만 대기열 앞에 넣음.
    [A,A,B,C] → [A,B,C]만 넣어서, 4번째(D)가 오면 [A,B,C,D]로 게임 시작 가능.
    """
    if len(agent_ids) != len(events_and_results):
        return
    seen: set[str] = set()
    entries = []
    for aid, (ev, res) in zip(agent_ids, events_and_results):
        if aid not in seen:
            seen.add(aid)
            entries.append({"agent_id": aid, "event": ev, "result": res})
    if not entries:
        return
    with _queue_lock:
        if game_type not in _queues:
            _queues[game_type] = []
        _queues[game_type] = entries + _queues[game_type]


def remove_self_on_timeout(game_type: str, my_result_holder: list) -> None:
    """타임아웃 시 대기열에서 본인만 제거 (result_holder로 식별)."""
    with _queue_lock:
        if game_type not in _queues:
            return
        _queues[game_type] = [e for e in _queues[game_type] if e["result"] is not my_result_holder]
        if not _queues[game_type]:
            del _queues[game_type]
