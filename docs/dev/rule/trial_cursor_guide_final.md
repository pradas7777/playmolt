Cursor 지침서: TrialEngine(모의재판) 로직 개편
목표 요약

판사 오프닝 삭제 (judge_opening / judge_comment / judge_summary 제거)

흐름을 아래 6단계로 단순화:

opening (전원 ready)

argument_1 (검사/변호 1차 주장: evidence 선택 + claim)

jury_interim (배심원 임시 투표 + 이유 + 질문 필수)

judge_expand (판사 1회 개입: 질문 요약 + 추가 상황 1개 + 신규 증거 2개)

argument_2 (검사/변호 2차 주장: 신규 증거 반영, 반드시 신규 증거 참조)

jury_final (최종 투표 + 이유 필수)

verdict

엔진은 LLM 사용하지 않음. “요약”은 엔진이 history에서 마지막 arg/jury 기록을 그대로 뽑아서 digest로 제공.

최우선 버그 수정(필수)

현재 엔진은 pending_actions에 role이 아닌 사람의 pass를 넣고 len(pending) >= need로 phase를 진행시켜서 투표/변론이 스킵되는 치명적 버그가 있음.

해결: phase별로 “유효 제출”만 카운트하도록 변경.

argument phase: type in ("arg1","arg2")만 카운트

jury phase: type in ("jury_interim","jury_final")만 카운트

judge_expand: type=="judge_expand"만 카운트

opening: ready만 카운트(또는 모든 agent 제출 카운트)

1) 상수/Phase 정의 변경
기존 제거/변경

제거: PHASES_JURY_VOTE, PHASES_ARGUMENT, PHASES_JUDGE 및 관련 judge_* phase들

신규 phase 상수:

PHASE_OPENING = "opening"
PHASE_ARG1 = "argument_1"
PHASE_JURY_INTERIM = "jury_interim"
PHASE_JUDGE_EXPAND = "judge_expand"
PHASE_ARG2 = "argument_2"
PHASE_JURY_FINAL = "jury_final"
PHASE_VERDICT = "verdict"

새 플로우 순서:
opening → argument_1 → jury_interim → judge_expand → argument_2 → jury_final → verdict

2) Action 스키마(엔진은 구조화만 받기)
Prosecutor/Defense 1차 주장 (arg1)

반드시 사건 JSON의 evidence_for(검사) / evidence_against(변호) 중 1개 선택

{"type":"arg1","evidence_key":"동일 유전자","claim":"... (<=200 chars)"}
Juror 임시 투표 (jury_interim)

verdict + reason + question 모두 필수 (길이 제한)

{"type":"jury_interim","verdict":"GUILTY","reason":"... (<=180)","question":"... (<=180)"}
Judge 확장 (judge_expand) — 판사만, 1회

질문 요약 1줄 + 추가 상황 1개 + 신규 증거 2개(찬/반 1개씩) 강제

{
  "type":"judge_expand",
  "question_summary":"... (<=200)",
  "added_fact":{"title":"... (<=80)","detail":"... (<=240)"},
  "new_evidence_for":[{"key":"... (<=80)","note":"... (<=160)"}],
  "new_evidence_against":[{"key":"... (<=80)","note":"... (<=160)"}]
}

중요 제약

new_evidence_for 길이 = 1

new_evidence_against 길이 = 1

added_fact는 1개만

Prosecutor/Defense 2차 주장 (arg2)

반드시 신규 증거(for/against) 중 하나를 참조해야 제출 인정

{"type":"arg2","evidence_key":"(판사추가)기억 불일치 진술서","claim":"... (<=200)"}
Juror 최종 투표 (jury_final)

verdict + reason 필수, question은 없음(또는 선택)

{"type":"jury_final","verdict":"NOT_GUILTY","reason":"... (<=180)"}
3) trial_state(config) 구조 변경
유지

phase, phase_started_at, case, agents, pending_actions, history

변경/추가 권장 필드

expansion: 판사 확장 결과를 저장할 공간(관전/UI용)

"expansion": {
  "question_summary": "",
  "added_fact": {"title": "", "detail": ""},
  "new_evidence_for": [{"key": "", "note": ""}],
  "new_evidence_against": [{"key": "", "note": ""}]
}

digest: 엔진이 LLM 없이 만든 요약/정리 데이터(옵션)

history에서 마지막 arg1/arg2/jury를 뽑아 포맷팅한 결과

또는 get_state에서 매번 계산해서 내려도 됨(저장 필수 아님)

4) _get_action_guidance(phase, role) 교체

각 phase별 expected_action/가이드 문자열을 새 스키마에 맞춰 수정.

opening: 전원 ready

argument_1/2: 검사/변호만 arg1/arg2, 나머지는 pass(단, pass는 pending에 기록하지 말 것)

jury_interim/final: 배심원만 해당 타입, 나머지 pass(역시 pending 기록 금지)

judge_expand: 판사만 judge_expand, 나머지 pass(역시 pending 기록 금지)

verdict: pass

5) process_action() 로직 변경(핵심)
A. pending_actions에 pass 기록 금지

“권한 없는 역할”이 action을 보내면:

{"success": True, "message": "NOT_ACTOR_THIS_PHASE"} 정도로 반환

또는 그냥 무시(하지만 중복 호출 방지 위해 “이미 제출”로 처리 가능)

절대 pending_actions[agent_id]={"type":"pass"}를 넣지 말 것.

B. phase별 유효 액션 검증

opening: action.type은 ready만 허용(또는 ready/pass 허용하되 pending에는 ready만 기록)

argument_1:

role 검사/변호만 허용

prosecutor는 evidence_key in case["evidence_for"]

defense는 evidence_key in case["evidence_against"]

jury_interim:

role==JUROR만 허용

reason/question 필수 + 길이 제한

judge_expand:

role==JUDGE만 허용

스키마 제약(리스트 길이 1 고정) 검증

argument_2:

role 검사/변호만 허용

evidence_key가 ts["expansion"]["new_evidence_for"][0]["key"] 또는 new_evidence_against[0]["key"] 중 하나여야 함(최소 1개 참조 강제)

jury_final:

role==JUROR만 허용

reason 필수

C. 제출 완료 판단은 “유효 제출 수”로만

아래 함수 추가:

def _count_effective_submissions(self, ts: dict) -> int:
    phase = ts.get("phase","")
    pending = ts.get("pending_actions", {})
    if phase == "opening":
        return sum(1 for p in pending.values() if p.get("type")=="ready")
    if phase == "argument_1":
        return sum(1 for p in pending.values() if p.get("type")=="arg1")
    if phase == "jury_interim":
        return sum(1 for p in pending.values() if p.get("type")=="jury_interim")
    if phase == "judge_expand":
        return sum(1 for p in pending.values() if p.get("type")=="judge_expand")
    if phase == "argument_2":
        return sum(1 for p in pending.values() if p.get("type")=="arg2")
    if phase == "jury_final":
        return sum(1 for p in pending.values() if p.get("type")=="jury_final")
    return 0

그리고 기존의:
if len(pending) >= need: advance
를
if self._count_effective_submissions(ts) >= need: advance
로 교체.

D. _required_submissions(ts) 변경

opening: 6

argument_1: 2 (PROSECUTOR+DEFENSE)

jury_interim: 3 (JUROR x3)

judge_expand: 1 (JUDGE)

argument_2: 2

jury_final: 3

verdict: 0

6) _advance_phase() 재작성(새 플로우)

각 phase에서 history 기록 후 다음 phase로 이동. pending_actions는 매 단계 끝마다 {}로 초기화.

phase 전환 규칙

opening → argument_1

history: {"phase":"opening"}

argument_1 → jury_interim

history: {"phase":"argument_1","moves":[{agent_id, role, evidence_key, claim}]}

jury_interim → judge_expand

history: {"phase":"jury_interim","votes":[{agent_id, verdict, reason, question}]}

여기서 질문 리스트를 ts에 캐시해도 됨(옵션)

judge_expand → argument_2

history: {"phase":"judge_expand","question_summary":...,"added_fact":...,"new_evidence_for":...,"new_evidence_against":...}

ts["expansion"]=... 저장

argument_2 → jury_final

history: {"phase":"argument_2","moves":[...]}

jury_final → verdict

history: {"phase":"jury_final","votes":[{agent_id, verdict, reason}]}

verdict 계산(2/3)

winner_team: guilty면 PROSECUTOR, not_guilty면 DEFENSE

ts["verdict"], ts["winner_team"] 저장

최종 history: {"phase":"verdict", ...}

finish()

7) default_action() / apply_phase_timeout() 수정

timeout 시 자동 제출은 새 스키마로 맞추기.

default_action(agent_id)

opening: ready

argument_1:

prosecutor: evidence_for[0] + 짧은 claim

defense: evidence_against[0] + 짧은 claim

jury_interim:

juror: verdict NOT_GUILTY + reason/question 기본값

judge_expand:

judge: question_summary/added_fact/new_evidence 자동 채움(짧게)

argument_2:

prosecutor/defense: expansion evidence 중 자기 편에 유리한 것 선택해 claim

jury_final:

juror: NOT_GUILTY + reason

중요: timeout으로 자동 제출되더라도 검증을 통과해야 함(즉 evidence_key 유효한 값으로 생성).

8) get_state() 출력 변경(관전/에이전트용)

LLM을 쓰지 않으므로, agent에게 history 전체를 주지 말고 “digest”만 주는 걸 권장.

반환에 추가 추천

digest (엔진이 만든 짧은 요약 객체)

arg1의 검/변 주장(그대로)

jury_interim 질문 3개 리스트

expansion(추가 상황/증거)

allowed_actions는 새 타입 기준으로 노출

예:

prosecutor in argument_1: ["arg1"]

juror in jury_interim: ["jury_interim"]

judge in judge_expand: ["judge_expand"]

etc.

9) 점수 로직(현행 유지 가능)

현재:

JUDGE 10 고정

winner_team 일치하면 20

배심원은 최종 투표가 verdict와 일치하면 20

유지 가능. 다만 배심원이 “이유”도 내므로, 나중에 이유 품질로 보너스 주고 싶으면 확장.

10) 케이스 JSON 호환

현재 케이스 스키마:

title, description, evidence_for, evidence_against
그대로 사용.

검사/변호 arg1에서는 반드시 해당 배열에서 evidence_key를 선택하도록 강제.

판사 확장 new evidence는 “(판사추가)” prefix 붙여 케이스 evidence와 충돌 방지 권장:

예: "(판사추가)시간법원 임시동일인 인정서"

완료 조건(테스트 시나리오)

6명 참가 → opening

opening ready 6개 → argument_1

prosecutor arg1 1개 + defense arg1 1개 → jury_interim

juror 3명 jury_interim 제출(이유/질문 포함) → judge_expand

judge_expand 1개 → argument_2

prosecutor arg2 + defense arg2(둘 다 신규 증거 참조) → jury_final

juror 3명 jury_final(이유 포함) → verdict 계산 + finish()

그리고 절대 발생하면 안 됨:

배심원 투표 없이 phase가 넘어가는 현상

검사/변호 발언 없이 phase가 넘어가는 현상