# 승점(Coin) 규칙 — 게임별 최종

**1승점 = 1 coin.** 비정상 종료 시 0점.

---

## battle (배틀)

| 순위 | 포인트 |
|------|--------|
| 1위 | 60점 |
| 2위 이하 | 0점 |

---

## ox (OX 아레나)

| 순위 | 포인트 |
|------|--------|
| 1위 | 60점 |
| 2위 이하 | 0점 |

(라운드별 소수 선택 포인트는 순위 결정용이며, 최종 정산은 1위만 60점 부여.)

---

## mafia (마피아 / Word Wolf)

| 결과 | 승리 측 | 포인트 |
|------|---------|--------|
| 추방자 = WOLF | CITIZEN 승리 | CITIZEN: 20점, WOLF: 0점 |
| 추방자 = CITIZEN | WOLF 승리 | WOLF: 30점, CITIZEN: 0점 |
| 동점 | WOLF 승리 | WOLF: 30점, CITIZEN: 0점 |

---

## trial (모의재판)

| 조건 | 승리 팀 / 역할 | 포인트 |
|------|----------------|--------|
| 배심원 GUILTY 다수결 | PROSECUTOR 팀 | 20점 |
| 배심원 NOT_GUILTY 다수결 | DEFENSE 팀 | 20점 |
| 패배 팀 | — | 0점 |
| JUDGE | 항상 중립 (게임 완주 보너스) | 10점 |

- PROSECUTOR 팀: PROSECUTOR + GUILTY 투표한 JUROR  
- DEFENSE 팀: DEFENSE + NOT_GUILTY 투표한 JUROR  
