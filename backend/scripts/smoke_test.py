"""실서버 스모크 테스트: 헬스, auth 501, 구글 엔드포인트 확인."""
import urllib.request
import json
import sys

import httpx

BASE = "http://127.0.0.1:8000"


def request(method, path, body=None):
    """단순 REST 요청 (리다이렉트는 기본 동작 그대로)."""
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        r = urllib.request.urlopen(req, timeout=5)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def check_google_endpoint() -> int:
    """
    /api/auth/google 는 두 가지 케이스가 있다.
    - GOOGLE_CLIENT_ID/SECRET 미설정: 501
    - 설정됨: 302 → 구글 로그인 페이지로 리다이렉트

    urllib는 302를 자동으로 따라가서 200(html)을 돌려주므로,
    여기서는 httpx로 follow_redirects=False 로 직접 확인한다.
    """
    try:
        r = httpx.get(BASE + "/api/auth/google", follow_redirects=False, timeout=5.0)
        return r.status_code
    except httpx.HTTPError:
        return 0


def main():
    ok = 0
    # health
    code, _ = request("GET", "/health")
    if code == 200:
        print("[OK] GET /health -> 200")
        ok += 1
    else:
        print("[FAIL] GET /health ->", code)
        return 1

    # register 501
    code, body = request(
        "POST",
        "/api/auth/register",
        body=json.dumps({"email": "t@t.com", "username": "tu", "password": "pass123456"}).encode(),
    )
    if code == 501 and "google" in body.lower():
        print("[OK] POST /api/auth/register -> 501 (google only)")
        ok += 1
    else:
        print("[FAIL] POST /api/auth/register ->", code, body[:80])

    # login 501
    code, body = request(
        "POST",
        "/api/auth/login",
        body=json.dumps({"email": "t@t.com", "password": "pass"}).encode(),
    )
    if code == 501 and "google" in body.lower():
        print("[OK] POST /api/auth/login -> 501 (google only)")
        ok += 1
    else:
        print("[FAIL] POST /api/auth/login ->", code, body[:80])

    # google: 501 (no config) or 302 (redirect to Google)
    g_code = check_google_endpoint()
    if g_code in (501, 302):
        print("[OK] GET /api/auth/google ->", g_code)
        ok += 1
    else:
        print("[FAIL] GET /api/auth/google ->", g_code)

    print()
    print(ok, "/ 4 checks passed.")
    return 0 if ok == 4 else 1


if __name__ == "__main__":
    sys.exit(main())
