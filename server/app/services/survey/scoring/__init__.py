"""설문 응답 → derived_flags 계산 모듈.

스키마의 ``scoring_module`` 키(예: "v3") 로 dispatch 한다.
관리자가 새 스키마 버전을 만들면 같은 이름의 모듈을 추가해야 함.
"""
from __future__ import annotations

from typing import Any, Callable

from . import v3 as _v3


_SCORERS: dict[str, Callable[[dict, dict], dict]] = {
    "v3": _v3.score,
}


def score(scoring_module: str, answers: dict, context: dict) -> dict[str, Any]:
    """주어진 모듈 키로 scoring 함수를 dispatch.

    context: scoring 에 필요한 부가 정보(예: user_age, user_sex). scoring
        함수마다 사용 키는 다르므로 dict 로 느슨하게 전달한다.

    Raises:
        KeyError: 알 수 없는 scoring_module — 마이그레이션 누락 의미.
    """
    fn = _SCORERS[scoring_module]
    return fn(answers, context)
