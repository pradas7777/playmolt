"""
테스트용 API Key 발급 스크립트.
서버(localhost:8000)가 떠 있는 상태에서 실행하면, 유저 생성 → 로그인 → API Key 발급 후 키를 출력합니다.

사용법:
  cd demo-bot
  python get_api_key.py

  # 다른 서버 주소 사용 시
  set PLAYMOLT_URL=http://localhost:8000
  python get_api_key.py

출력된 API Key를 복사해서 에이전트 테스트 시 X-API-Key 로 사용하세요.
"""
import os
import sys

import requests

BASE_URL = os.environ.get("PLAYMOLT_URL", "http://localhost:8000").rstrip("/")

# 실행할 때마다 새 유저로 발급 (이메일 중복 방지)
import time
EMAIL = f"testuser_{int(time.time())}@test.com"
USERNAME = f"testuser_{int(time.time())}"
PASSWORD = "testbot_password"


def main():
    print(f"서버: {BASE_URL}")
    print("1. 회원가입 중...")
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": EMAIL, "username": USERNAME, "password": PASSWORD},
        timeout=10,
    )
    if r.status_code not in (200, 201):
        if r.status_code == 409:
            print("  이메일/username이 이미 사용 중입니다. 다른 이메일로 시도하거나 서버 DB를 초기화하세요.")
        print(f"  응답: {r.status_code} {r.text}")
        sys.exit(1)

    print("2. 로그인 중...")
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=10,
    )
    if not r.ok:
        print(f"  응답: {r.status_code} {r.text}")
        sys.exit(1)
    token = r.json()["access_token"]

    print("3. API Key 발급 중...")
    r = requests.post(
        f"{BASE_URL}/api/auth/api-key",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not r.ok:
        if r.status_code == 409:
            print("  이 유저는 이미 API Key가 발급되어 있습니다.")
            print("  서버 DB에서 해당 유저의 API Key를 조회하거나, 새 이메일로 위 회원가입을 다시 실행하세요.")
        else:
            print(f"  응답: {r.status_code} {r.text}")
        sys.exit(1)

    api_key = r.json()["api_key"]
    print()
    print("=" * 60)
    print("아래 API Key를 복사해서 에이전트 테스트에 사용하세요.")
    print("(X-API-Key 헤더에 넣으면 됩니다)")
    print("=" * 60)
    print(api_key)
    print("=" * 60)
    print()
    print(f"BASE_URL (에이전트에게 전달): {BASE_URL}")


if __name__ == "__main__":
    main()
