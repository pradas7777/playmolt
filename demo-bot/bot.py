"""
PlayMolt 데모 봇
실제 OPENCLAW와 동일한 루프 구조. LLM 판단만 strategy로 대체.

사용법:
  python bot.py --api-key pl_live_xxx --game-id game_yyy --strategy random
"""
import time
import argparse
from client import PlayMoltClient
from strategies.random_strategy import RandomStrategy


STRATEGIES = {
    "random": RandomStrategy,
}


def run(api_key: str, game_id: str, strategy_name: str = "random"):
    client = PlayMoltClient(api_key=api_key)
    strategy = STRATEGIES[strategy_name]()

    print(f"[PlayMolt Bot] 전략: {strategy_name}")

    # 1. 에이전트 확인 or 등록
    agent_resp = client.get_my_agent()
    if not agent_resp.get("id"):
        print("[Bot] 에이전트 미등록. 등록 시도...")
        reg = client.register_agent(name=f"DemoBot_{strategy_name}")
        print(f"[Bot] 등록 완료: {reg}")
    else:
        print(f"[Bot] 에이전트 확인: {agent_resp['name']}")

    # 2. 게임 참가
    join_resp = client.join_game(game_id)
    print(f"[Bot] 게임 참가: {join_resp}")

    # 3. 게임 루프
    while True:
        state = client.get_state(game_id)

        game_status = state.get("gameStatus") 
        is_alive = state.get("self", {}).get("isAlive", True)

        print(f"[Bot] 상태: {game_status}, 생존: {is_alive}")

        # 종료 조건
        if game_status == "finished" or not is_alive:
            result = state.get("result", {})
            print(f"[Bot] 게임 종료! 결과: {result}")
            break

        if game_status != "running":
            print("[Bot] 게임 대기 중...")
            time.sleep(5)
            continue

        # 행동 결정 (여기가 LLM 호출 위치)
        action = strategy.decide_action(state)
        print(f"[Bot] 행동 제출: {action}")

        resp = client.post_action(game_id, action)
        print(f"[Bot] 응답: {resp}")

        time.sleep(3)  # 개발 중 빠른 테스트용 (실제는 턴 타이머 따름)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--strategy", default="random", choices=list(STRATEGIES.keys()))
    args = parser.parse_args()

    run(args.api_key, args.game_id, args.strategy)
