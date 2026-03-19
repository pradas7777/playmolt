"""
모의재판(Trial) 게임 봇 1마리 독립 실행.

새 플로우: opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict.
expected_action에 따라 arg1/arg2(검·변), jury_interim/jury_final(배심원), judge_expand(판사) 제출.

실행: python trial/bot.py --name t1  (6명까지 별도 실행)
"""
import argparse
import random
import sys
import time

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from common.client import PlayMoltClient
from common.names import pick_unique_names
from trial.brain import (
    build_arg1,
    build_arg2,
    build_judge_expand,
    build_jury_final,
    build_jury_interim,
)


def submit_action_with_retry(
    client: PlayMoltClient, game_id: str, action: dict, state: dict, bot_name: str
) -> bool:
    """액션 제출. 400 시 ALREADY_ACTED/GAME_NOT_RUNNING 처리. 재시도는 'brain 재생성'만 사용."""
    try:
        client.submit_action(game_id, action)
        return True
    except requests.HTTPError as e:
        if e.response.status_code != 400:
            raise
        try:
            body = e.response.json()
            detail = body.get("detail", body) if isinstance(body, dict) else {}
        except Exception:
            detail = {}
        if not isinstance(detail, dict):
            raise
        err = detail.get("error", "")
        expected = detail.get("expected_action", "")
        if err == "ALREADY_ACTED":
            print(f"[{bot_name}] 이미 제출함 (이번 phase) → 대기")
            return False
        if err == "GAME_NOT_RUNNING":
            print(f"[{bot_name}] 게임 이미 종료됨 → 루프에서 상태 확인 후 종료")
            return False
        # pass 제출 후 400이면 다른 액션으로 재시도하지 않음 (이 에이전트는 해당 phase 행동자 아님)
        if action.get("type") == "pass":
            print(f"[{bot_name}] pass 제출 후 400 (error={err}) → 재시도 안 함")
            return False

        # 재시도: 항상 최신 state로 brain 재생성
        fresh = client.get_state(game_id)
        if fresh.get("gameStatus") == "finished":
            print(f"[{bot_name}] 재시도 중 게임 종료 감지 → 중단")
            return False
        persona = str(fresh.get("_bot_persona") or "")
        memory = fresh.get("_bot_memory") or {}
        role = fresh.get("self", {}).get("role", "")
        history = fresh.get("history", []) or []
        case = fresh.get("case") or {}
        expansion = fresh.get("expansion") or {}

        if expected == "ready":
            client.submit_action(game_id, {"type": "ready"})
            return True
        if expected == "arg1":
            built = build_arg1(role, case, history, persona, memory=memory)
            retry = {"type": "arg1", "evidence_key": built["evidence_key"], "claim": built["claim"]}
            client.submit_action(game_id, retry)
            return True
        if expected == "jury_interim":
            built = build_jury_interim(history, persona, memory=memory, case=case)
            retry = {
                "type": "jury_interim",
                "verdict": built["verdict"],
                "reason": built["reason"],
                "question": built["question"],
            }
            client.submit_action(game_id, retry)
            return True
        if expected == "judge_expand":
            built = build_judge_expand(history, persona, memory=memory, case=case)
            retry = {
                "type": "judge_expand",
                "question_summary": built["question_summary"],
                "added_fact": built["added_fact"],
                "new_evidence_for": built["new_evidence_for"],
                "new_evidence_against": built["new_evidence_against"],
            }
            client.submit_action(game_id, retry)
            return True
        if expected == "arg2":
            built = build_arg2(role, expansion, history, persona, memory=memory, case=case)
            retry = {"type": "arg2", "evidence_key": built["evidence_key"], "claim": built["claim"]}
            client.submit_action(game_id, retry)
            return True
        if expected == "jury_final":
            built = build_jury_final(history, persona, memory=memory)
            retry = {"type": "jury_final", "verdict": built["verdict"], "reason": built["reason"]}
            client.submit_action(game_id, retry)
            return True

        print(f"[{bot_name}] 액션 실패 error={err} expected={expected}", file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description="모의재판 테스트 봇 1마리 (6인)")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument(
        "--persona",
        default="논리적",
        choices=["전략적", "감성적", "보수적", "도전적", "논리적"],
        help="페르소나(말투/성향). 변론/질문/평결 문장이 페르소나에 따라 달라짐",
    )
    args = parser.parse_args()

    bot_name = args.name or pick_unique_names(1)[0]
    client = PlayMoltClient(base_url=args.url, name=bot_name)
    memory: dict = {}
    persona = args.persona

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=f"{args.persona}적인 AI")
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("trial")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)
        # 400 재시도에서도 예시 문장 대신 brain 재생성을 쓰기 위해 주입
        state["_bot_memory"] = memory
        state["_bot_persona"] = persona

        if state.get("gameStatus") == "finished":
            result = state.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | verdict={result.get('verdict')} 포인트={result.get('points', 0)}")
            break

        expected = state.get("expected_action") or ""
        role = state.get("self", {}).get("role", "")
        phase = state.get("phase", "")

        if expected == "":
            time.sleep(0.5)
            continue

        if expected == "pass":
            # pass = 이번 phase에서 행동할 역할 아님 또는 이미 제출함. 제출하지 않고 대기만.
            time.sleep(0.5)
            continue

        # 제출 직전에 한 번 더 확인 → 게임이 이미 종료되었으면 제출하지 않고 종료
        state2 = client.get_state(game_id)
        if state2.get("gameStatus") == "finished":
            result = state2.get("result") or {}
            print(f"[{bot_name}] 게임 종료 | verdict={result.get('verdict')} 포인트={result.get('points', 0)}")
            break

        if expected == "ready":
            action = {"type": "ready"}
            print(f"[{bot_name}] ready 제출 phase={phase}")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "arg1":
            case = state.get("case", {})
            built = build_arg1(role, case, state.get("history", []) or [], persona, memory=memory)
            evidence_key = built["evidence_key"]
            claim = built["claim"]
            action = {"type": "arg1", "evidence_key": evidence_key, "claim": claim}
            print(f"[{bot_name}] arg1 제출 role={role} evidence_key={evidence_key[:20]}... claim={claim[:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "jury_interim":
            built = build_jury_interim(state.get("history", []) or [], persona, memory=memory, case=state.get("case") or {})
            verdict = built["verdict"]
            action = {
                "type": "jury_interim",
                "verdict": verdict,
                "reason": built["reason"],
                "question": built["question"],
            }
            print(f"[{bot_name}] jury_interim 제출 verdict={verdict} reason={action['reason'][:40]}... question={action['question'][:40]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "judge_expand":
            built = build_judge_expand(state.get("history", []) or [], persona, memory=memory, case=state.get("case") or {})
            action = {
                "type": "judge_expand",
                "question_summary": built["question_summary"],
                "added_fact": built["added_fact"],
                "new_evidence_for": built["new_evidence_for"],
                "new_evidence_against": built["new_evidence_against"],
            }
            print(f"[{bot_name}] judge_expand 제출 question_summary={action['question_summary'][:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "arg2":
            # 검사=expansion.new_evidence_for, 변호=expansion.new_evidence_against 에서만 선택
            built = build_arg2(
                role,
                state2.get("expansion") or state.get("expansion") or {},
                state.get("history", []) or [],
                persona,
                memory=memory,
                case=state.get("case") or {},
            )
            evidence_key = built["evidence_key"]
            claim = built["claim"]
            action = {"type": "arg2", "evidence_key": evidence_key, "claim": claim}
            print(f"[{bot_name}] arg2 제출 role={role} evidence_key={evidence_key[:30]}... claim={claim[:50]}...")
            submit_action_with_retry(client, game_id, action, state2, bot_name)
            time.sleep(1.0)
            continue

        if expected == "jury_final":
            built = build_jury_final(state.get("history", []) or [], persona, memory=memory)
            verdict = built["verdict"]
            action = {"type": "jury_final", "verdict": verdict, "reason": built["reason"]}
            print(f"[{bot_name}] jury_final 제출 verdict={verdict} reason={action['reason'][:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        time.sleep(0.5)


if __name__ == "__main__":
    main()
