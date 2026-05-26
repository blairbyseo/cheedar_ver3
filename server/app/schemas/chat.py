from datetime import datetime

from pydantic import BaseModel, Field

from app.models.chat import ChatRole


class ChatMessageOut(BaseModel):
    id: int
    role: ChatRole
    text: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSendRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
