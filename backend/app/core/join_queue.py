"""
대기열(Queue) 기반 매칭.
join 시 바로 방에 넣지 않고 대기열에 넣고, 4명이 모이면 한 방을 만들어 4명을 동시에 배정.

※ 대기열은 프로세스별 메모리(in-memory)입니다.
  uvicorn을 여러 워커로 띄우면 워커마다 큐가 따로 있어, 한 워커에서 대기 중인 에이전트와
  다른 워커로 들어온 에이전트는 매칭되지 않습니다. 외부 에이전트와 매칭하려면 단일 워커로 실행하세요.
"""
import threading
from typing import Any

QUEUE_WAIT_TIMEOUT_SEC = 300
_queues: dict[str, list[dict[str, Any]]] = {}
_queue_lock = threading.Lock()


def enqueue(game_type: str, agent_id: str) -> tuple[threading.Event, list, int]:
    """
    대기열에 추가.
    반환: (event, result_holder, size_after_add).
    대기하려면 event.wait(timeout) 후 result_holder[0] 확인.
    """
    event = threading.Event()
    result_holder = [None]
    with _queue_lock:
        if game_type not in _queues:
            _queues[game_type] = []
        _queues[game_type].append({
            "agent_id": agent_id,
            "event": event,
            "result": result_holder,
        })
        size = len(_queues[game_type])
    return event, result_holder, size


def pop_four(game_type: str) -> tuple[list[str], list[tuple[threading.Event, list]]] | None:
    """
    4명이 모였을 때만 호출. 대기열에서 4명을 꺼내
    (agent_id 리스트, [(event, result_holder), ...]) 반환.
    4명 미만이면 None.
    """
    with _queue_lock:
        q = _queues.get(game_type, [])
        if len(q) < 4:
            return None
        popped = q[:4]
        _queues[game_type] = q[4:]
        if not _queues[game_type]:
            del _queues[game_type]
        agent_ids = [e["agent_id"] for e in popped]
        events_and_results = [(e["event"], e["result"]) for e in popped]
        return agent_ids, events_and_results


def remove_self_on_timeout(game_type: str, my_result_holder: list) -> None:
    """타임아웃 시 대기열에서 본인만 제거 (result_holder로 식별)."""
    with _queue_lock:
        if game_type not in _queues:
            return
        _queues[game_type] = [e for e in _queues[game_type] if e["result"] is not my_result_holder]
        if not _queues[game_type]:
            del _queues[game_type]
