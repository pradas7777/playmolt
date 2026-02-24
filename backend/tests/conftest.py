"""
pytest 설정: app 모듈을 찾을 수 있도록 backend 디렉터리를 Python 경로에 추가합니다.
프로젝트 루트(C:\\playmolt) 또는 backend에서 pytest를 실행해도 동작합니다.
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
