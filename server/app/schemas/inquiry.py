"""문의하기 스키마.

사용자가 남긴 문의(InquiryCreate)를 받고, 관리자 화면에 작성자 정보를 곁들여
돌려준다(InquiryOut).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class InquiryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000, description="문의 내용")


class InquiryResolveRequest(BaseModel):
    is_resolved: bool = Field(description="처리완료(True) / 미처리(False)")


class InquiryOut(BaseModel):
    id: int
    user_id: int
    account_id: str  # 작성자 로그인 아이디(user.user_id)
    nickname: str | None
    content: str
    is_resolved: bool
    created_at: datetime
