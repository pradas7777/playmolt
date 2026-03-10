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


# 변론·질문·이유 예시 (로그에서 확인용)
EXAMPLE_CLAIM_ARG1 = "해당 증거는 피고의 유죄를 뒷받침합니다. 1차 주장을 제출합니다."
EXAMPLE_CLAIM_ARG2 = "판사가 제시한 추가 증거를 반영하여, 2차 주장에서 유죄/무죄 입장을 재강화합니다."
EXAMPLE_REASON = "검찰 측 1차 주장과 변호 측 반박을 종합했을 때, 당장은 유죄/무죄 판단을 유보하고 추가 질문이 필요하다고 봅니다."
EXAMPLE_QUESTION = "증거의 시점과 피고인과의 연관성이 공식 기록으로 입증되었는지 확인이 필요합니다."
EXAMPLE_QUESTION_SUMMARY = "배심원 3명의 질문을 요약하면, 증거의 시점·연관성·공식 기록 입증 여부에 대한 확인 요청입니다."
EXAMPLE_ADDED_FACT_TITLE = "추가 상황: 목격자 보조 진술서 접수"
EXAMPLE_ADDED_FACT_DETAIL = "재판 중 목격자 보조 진술서가 제출되었으며, 당일 시간대와 장소에 대한 내용이 포함되어 있습니다."
EXAMPLE_FINAL_REASON = "1·2차 변론과 판사의 추가 증거를 모두 고려한 결과, 합리적 의심을 넘어선 유죄/무죄로 판단합니다."


def _ev_for(state: dict) -> list:
    return state.get("case", {}).get("evidence_for") or ["증거"]


def _ev_against(state: dict) -> list:
    return state.get("case", {}).get("evidence_against") or ["반증"]


def _expansion_keys(state: dict) -> list:
    exp = state.get("expansion") or {}
    keys = [e.get("key", "") for e in (exp.get("new_evidence_for") or []) if e.get("key")]
    keys += [e.get("key", "") for e in (exp.get("new_evidence_against") or []) if e.get("key")]
    return keys


def _expansion_key_for_role(state: dict, role: str) -> str | None:
    """arg2에서 역할별 허용 키 1개 반환. 검사=new_evidence_for, 변호=new_evidence_against."""
    exp = state.get("expansion") or {}
    if role == "PROSECUTOR":
        lst = exp.get("new_evidence_for") or []
    elif role == "DEFENSE":
        lst = exp.get("new_evidence_against") or []
    else:
        return None
    for e in lst:
        if e.get("key"):
            return e.get("key")
    return None


def submit_action_with_retry(
    client: PlayMoltClient, game_id: str, action: dict, state: dict, bot_name: str
) -> bool:
    """액션 제출. 400 시 ALREADY_ACTED/GAME_NOT_RUNNING 처리."""
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
        if expected == "arg1":
            ev = _ev_for(state) if state.get("self", {}).get("role") == "PROSECUTOR" else _ev_against(state)
            key = ev[0] if ev else "증거"
            retry = {"type": "arg1", "evidence_key": key, "claim": EXAMPLE_CLAIM_ARG1[:200]}
            print(f"[{bot_name}] 400 후 재시도 expected_action=arg1 → claim={retry['claim'][:40]}...")
            client.submit_action(game_id, retry)
            return True
        if expected == "arg2":
            role = state.get("self", {}).get("role", "")
            k = _expansion_key_for_role(state, role)
            if not k:
                # state에 expansion 없으면 재조회
                fresh = client.get_state(game_id)
                k = _expansion_key_for_role(fresh, role)
            if not k:
                print(f"[{bot_name}] arg2 재시도 실패: expansion 키 없음 role={role}", file=sys.stderr)
                return False
            retry = {"type": "arg2", "evidence_key": k, "claim": EXAMPLE_CLAIM_ARG2[:200]}
            client.submit_action(game_id, retry)
            return True
        if expected == "jury_interim":
            retry = {"type": "jury_interim", "verdict": "NOT_GUILTY", "reason": EXAMPLE_REASON[:180], "question": EXAMPLE_QUESTION[:180]}
            client.submit_action(game_id, retry)
            return True
        if expected == "jury_final":
            retry = {"type": "jury_final", "verdict": "NOT_GUILTY", "reason": EXAMPLE_FINAL_REASON[:180]}
            client.submit_action(game_id, retry)
            return True
        if expected == "judge_expand":
            retry = {
                "type": "judge_expand",
                "question_summary": EXAMPLE_QUESTION_SUMMARY[:200],
                "added_fact": {"title": EXAMPLE_ADDED_FACT_TITLE[:80], "detail": EXAMPLE_ADDED_FACT_DETAIL[:240]},
                "new_evidence_for": [{"key": "(판사추가)검찰 추가 증거", "note": "요약"}],
                "new_evidence_against": [{"key": "(판사추가)변호 추가 증거", "note": "요약"}],
            }
            client.submit_action(game_id, retry)
            return True
        if expected == "ready":
            client.submit_action(game_id, {"type": "ready"})
            return True
        print(f"[{bot_name}] 액션 실패 error={err} expected={expected}", file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description="모의재판 테스트 봇 1마리 (6인)")
    parser.add_argument("--name", default=None, help="봇 이름")
    parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
    parser.add_argument("--persona", default="전략적인 AI", help="에이전트 페르소나")
    args = parser.parse_args()

    bot_name = args.name or f"trial_{int(time.time())}"
    client = PlayMoltClient(base_url=args.url, name=bot_name)

    print(f"[{bot_name}] 시작")

    info = client.register_and_verify(persona=args.persona)
    print(f"[{bot_name}] 인증 완료 agent_id={info.get('agent_id', '')[:8]}...")

    game_id = client.join_game("trial")
    print(f"[{bot_name}] 게임 참가 game_id={game_id[:8] if game_id else ''}...")

    while True:
        state = client.get_state(game_id)

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
            # phase가 진행되어 이미 arg2/jury_final 등이 필요할 수 있음 → 제출 직전에 재조회
            state2 = client.get_state(game_id)
            if state2.get("gameStatus") == "finished":
                result = state2.get("result") or {}
                print(f"[{bot_name}] 게임 종료 | verdict={result.get('verdict')} 포인트={result.get('points', 0)}")
                break
            if (state2.get("expected_action") or "") != "pass":
                # 다른 액션이 필요함(예: arg2) → pass 제출하지 않고 다음 루프에서 처리
                continue
            submit_action_with_retry(client, game_id, {"type": "pass"}, state2, bot_name)
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
            ev_for = case.get("evidence_for") or ["증거"]
            ev_against = case.get("evidence_against") or ["반증"]
            if role == "PROSECUTOR":
                evidence_key = ev_for[0]
                claim = EXAMPLE_CLAIM_ARG1
            else:
                evidence_key = ev_against[0]
                claim = "변호 측: 해당 반증은 피고의 무죄를 뒷받침합니다. 1차 반박을 제출합니다."[:200]
            action = {"type": "arg1", "evidence_key": evidence_key, "claim": claim[:200]}
            print(f"[{bot_name}] arg1 제출 role={role} evidence_key={evidence_key[:20]}... claim={claim[:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "jury_interim":
            verdict = random.choice(["GUILTY", "NOT_GUILTY"])
            action = {
                "type": "jury_interim",
                "verdict": verdict,
                "reason": EXAMPLE_REASON[:180],
                "question": EXAMPLE_QUESTION[:180],
            }
            print(f"[{bot_name}] jury_interim 제출 verdict={verdict} reason={action['reason'][:40]}... question={action['question'][:40]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "judge_expand":
            action = {
                "type": "judge_expand",
                "question_summary": EXAMPLE_QUESTION_SUMMARY[:200],
                "added_fact": {"title": EXAMPLE_ADDED_FACT_TITLE[:80], "detail": EXAMPLE_ADDED_FACT_DETAIL[:240]},
                "new_evidence_for": [{"key": "(판사추가)검찰 추가 증거", "note": "요약"}],
                "new_evidence_against": [{"key": "(판사추가)변호 추가 증거", "note": "요약"}],
            }
            print(f"[{bot_name}] judge_expand 제출 question_summary={action['question_summary'][:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        if expected == "arg2":
            # 검사=expansion.new_evidence_for, 변호=expansion.new_evidence_against 에서만 선택
            evidence_key = _expansion_key_for_role(state, role)
            if not evidence_key:
                # 제출 직전 state 재사용; expansion 없을 수 있음
                evidence_key = _expansion_key_for_role(state2, role)
            if not evidence_key:
                print(f"[{bot_name}] arg2 건너뜀: expansion 키 없음 role={role}", file=sys.stderr)
                time.sleep(1.0)
                continue
            claim = EXAMPLE_CLAIM_ARG2[:200]
            action = {"type": "arg2", "evidence_key": evidence_key, "claim": claim}
            print(f"[{bot_name}] arg2 제출 role={role} evidence_key={evidence_key[:30]}... claim={claim[:50]}...")
            submit_action_with_retry(client, game_id, action, state2, bot_name)
            time.sleep(1.0)
            continue

        if expected == "jury_final":
            verdict = random.choice(["GUILTY", "NOT_GUILTY"])
            action = {"type": "jury_final", "verdict": verdict, "reason": EXAMPLE_FINAL_REASON[:180]}
            print(f"[{bot_name}] jury_final 제출 verdict={verdict} reason={action['reason'][:50]}...")
            submit_action_with_retry(client, game_id, action, state, bot_name)
            time.sleep(1.0)
            continue

        time.sleep(0.5)


if __name__ == "__main__":
    main()
