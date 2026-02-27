"""실서버 스모크 테스트: 헬스, auth 501, 구글 엔드포인트 확인."""
import urllib.request
import json
import sys

BASE = "http://127.0.0.1:8000"

def request(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        r = urllib.request.urlopen(req, timeout=5)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

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
    code, body = request("POST", "/api/auth/register", body=json.dumps({"email": "t@t.com", "username": "tu", "password": "pass123456"}).encode())
    if code == 501 and "google" in body.lower():
        print("[OK] POST /api/auth/register -> 501 (google only)")
        ok += 1
    else:
        print("[FAIL] POST /api/auth/register ->", code, body[:80])

    # login 501
    code, body = request("POST", "/api/auth/login", body=json.dumps({"email": "t@t.com", "password": "pass"}).encode())
    if code == 501 and "google" in body.lower():
        print("[OK] POST /api/auth/login -> 501 (google only)")
        ok += 1
    else:
        print("[FAIL] POST /api/auth/login ->", code, body[:80])

    # google: 501 (no config) or 302
    code, body = request("GET", "/api/auth/google")
    if code in (501, 302):
        print("[OK] GET /api/auth/google ->", code)
        ok += 1
    else:
        print("[FAIL] GET /api/auth/google ->", code, body[:80])

    print()
    print(ok, "/ 4 checks passed.")
    return 0 if ok == 4 else 1

if __name__ == "__main__":
    sys.exit(main())
