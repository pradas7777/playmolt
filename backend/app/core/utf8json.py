"""
SQLite에서 한글 등 유니코드가 JSON config에 저장될 때 인코딩 깨짐 방지.
ensure_ascii=False 로 직렬화해 UTF-8 문자열로 저장합니다.
"""
import json
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class Utf8JsonType(TypeDecorator):
    """SQLite용: JSON을 UTF-8 문자열로 저장(ensure_ascii=False)해 한글 깨짐 방지."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            return json.dumps(value, ensure_ascii=False)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return json.loads(value)
        return value
