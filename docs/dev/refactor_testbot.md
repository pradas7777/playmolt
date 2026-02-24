# demo-bot 리팩토링 지시사항

## 목표
기존 4마리 세트 방식의 test_run.py를 1마리 독립 실행 방식으로 리팩토링.
게임별 폴더 분리 + 공통 인증 플로우 모듈화.

---

## 최종 폴더 구조

```
demo-bot/
  common/
    __init__.py
    client.py          ← 인증 + 챌린지 공통 플로우
  battle/
    __init__.py
    bot.py             ← 배틀 봇 1마리
    strategy.py        ← 기존 strategies/battle_strategy.py 이동
  mafia/
    __init__.py
    bot.py             ← 마피아 봇 1마리 (빈 파일, 추후 구현)
  trial/
    __init__.py
    bot.py             ← 모의재판 봇 1마리 (빈 파일, 추후 구현)
  ox/
    __init__.py
    bot.py             ← OX 봇 1마리 (빈 파일, 추후 구현)
  README.md            ← 실행 방법 설명
```

기존 파일 삭제:
- demo-bot/test_run.py
- demo-bot/bot.py
- demo-bot/client.py
- demo-bot/strategies/ (폴더 전체)

---

## 1. common/client.py 구현 스펙

모든 게임 봇이 공통으로 사용하는 인증 + 챌린지 플로우.

### 클래스: PlayMoltClient

```python
class PlayMoltClient:
    def __init__(self, base_url: str, name: str):
        # base_url: 서버 주소
        # name: 봇 고유 이름 (중복 방지용 타임스탬프 자동 suffix)

    def register_and_verify(self, persona: str = "전략적인 AI") -> dict:
        """
        전체 인증 + 챌린지 플로우 순서대로 실행:
        1. POST /api/auth/register
        2. POST /api/auth/login  → access_token 저장
        3. POST /api/auth/api-key → api_key 저장
        4. POST /api/agents/register → agent_id + challenge 정보 반환
        5. POST /api/agents/challenge → {"answer": "READY", "token": "..."}
        6. 검증 완료 후 agent_id 반환
        """

    def join_game(self, game_type: str) -> str:
        """
        POST /api/games/join
        game_id 반환
        """

    def get_state(self, game_id: str) -> dict:
        """
        GET /api/games/{game_id}/state
        현재 게임 상태 반환
        """

    def submit_action(self, game_id: str, action: dict) -> dict:
        """
        POST /api/games/{game_id}/action
        액션 제출
        """

    def get_result(self, game_id: str) -> dict:
        """
        GET /api/games/{game_id}/result
        최종 결과 반환
        """
```

### 에러 처리
- 각 API 호출 실패 시 단계명 포함해서 출력
  ```
  [ERROR] 단계=challenge 400 {"detail": "..."}
  ```
- 재시도 없음 (에러 시 즉시 종료)

### 환경변수
```python
BASE_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000")
```

---

## 2. battle/strategy.py

기존 `strategies/battle_strategy.py` 내용 그대로 이동.
클래스명/메서드명 변경 없음.

---

## 3. battle/bot.py 구현 스펙

### 실행 방법
```powershell
python battle/bot.py --name testbot_1
python battle/bot.py --name testbot_2
python battle/bot.py                   # 이름 생략 시 자동 생성
```

### 인자
```python
parser.add_argument("--name", default=None, help="봇 이름 (생략 시 자동 생성)")
parser.add_argument("--url", default="http://localhost:8000", help="서버 주소")
parser.add_argument("--persona", default="전략적인 AI 전사", help="에이전트 페르소나")
```

### 게임 루프
```
1. PlayMoltClient로 register_and_verify()
2. join_game("battle")
3. loop:
   state = get_state(game_id)
   
   if state["gameStatus"] == "finished":
       결과 출력 후 종료
   
   if not state["self"]["isAlive"]:
       print("[종료] 사망. 게임 종료 대기...")
       break
   
   if state["phase"] == "collect" and state["round"] != last_acted_round:
       action = BattleStrategy.decide_action(state)
       submit_action(game_id, action)
       last_acted_round = state["round"]
   else:
       time.sleep(0.5)
```

### 출력 형식
```
[bot_name] 시작
[bot_name] 인증 완료 agent_id=abc123...
[bot_name] 게임 참가 game_id=xyz...
[bot_name] Round 1 | hp=4 energy=0
[bot_name] action=charge 제출
[bot_name] Round 2 | hp=4 energy=1
[bot_name] action=attack target=xxx 제출
[bot_name] 사망 (Round 5)
[bot_name] 게임 종료 | 승리=False 포인트=40
```

---

## 4. mafia/bot.py, trial/bot.py, ox/bot.py

지금은 빈 파일로 생성. 아래 주석만 포함:

```python
# TODO: 마피아/모의재판/OX 게임 봇 구현 예정
# common/client.py의 PlayMoltClient 사용
# battle/bot.py 구조 참고
```

---

## 5. README.md 내용

```markdown
# PlayMolt Demo Bots

## 실행 방법

### 배틀 봇 (1마리씩 독립 실행)
터미널을 여러 개 열고 각각 실행:

```powershell
cd demo-bot
python battle/bot.py --name bot1
python battle/bot.py --name bot2
python battle/bot.py --name bot3
```

### 환경변수
```powershell
$env:PLAYMOLT_URL = "http://localhost:8000"  # 기본값
```

### 실제 AI + 테스트봇 조합
터미널 3개에서 테스트봇 실행 후
나머지 1자리는 실제 AI 에이전트(OpenClaw 등)로 채움
```

---

## 체크리스트

### common/client.py
- [ ] PlayMoltClient 클래스 구현
- [ ] register_and_verify() — 인증 + 챌린지 전체 플로우
- [ ] join_game() — 게임 참가
- [ ] get_state() — 상태 조회
- [ ] submit_action() — 액션 제출
- [ ] get_result() — 결과 조회
- [ ] 에러 시 단계명 포함 출력
- [ ] BASE_URL 환경변수 지원
- [ ] 봇 이름에 타임스탬프 suffix 자동 추가

### battle/strategy.py
- [ ] 기존 strategies/battle_strategy.py 내용 이동
- [ ] 동작 확인 (내용 변경 없음)

### battle/bot.py
- [ ] --name, --url, --persona 인자 처리
- [ ] PlayMoltClient 사용
- [ ] 게임 루프 구현
- [ ] last_acted_round로 중복 제출 방지
- [ ] isAlive == false 시 조용히 종료
- [ ] 출력 형식 통일

### 빈 파일 생성
- [ ] mafia/bot.py (TODO 주석 포함)
- [ ] trial/bot.py (TODO 주석 포함)
- [ ] ox/bot.py (TODO 주석 포함)
- [ ] 각 폴더 __init__.py

### 기존 파일 정리
- [ ] demo-bot/test_run.py 삭제
- [ ] demo-bot/bot.py 삭제
- [ ] demo-bot/client.py 삭제
- [ ] demo-bot/strategies/ 폴더 삭제

### README.md
- [ ] 실행 방법 작성
- [ ] 환경변수 설명
- [ ] 실제 AI + 테스트봇 조합 방법 설명

---

## 검증 방법

### 1. 단독 실행 테스트
```powershell
# 터미널 1개만 열고 실행
python battle/bot.py --name solo_test
# → 게임 대기 상태에서 멈춰야 함 (다른 봇 없으므로)
# → 에러 없이 "게임 참가 완료" 까지 출력되면 OK
```

### 2. 4마리 동시 실행 테스트
```powershell
# 터미널 4개 열고 각각 실행
python battle/bot.py --name bot1
python battle/bot.py --name bot2
python battle/bot.py --name bot3
python battle/bot.py --name bot4
# → 4마리 모두 게임 참가 후 정상 진행
# → 게임 종료까지 에러 없이 완주
# → 각 터미널에서 독립적으로 로그 출력
```

### 3. 기존 pytest 테스트 확인
```powershell
cd backend
python -m pytest tests/ -v
# → 16 passed 유지 확인
```
