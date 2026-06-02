import json

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import get_current_user
from app.models.chat import ChatMessage, ChatRole
from app.models.user import User
from app.schemas.chat import ChatMessageOut, ChatSendRequest
from app.services.diet_context import build_diet_context
from app.services.openai_client import CHAT_MOCK_RESPONSE, chat_completion_stream

router = APIRouter(prefix="/api/chat", tags=["chat"])

# OpenAI에 컨텍스트로 넘기는 직전 메시지 개수 (system 메시지 제외)
CONTEXT_WINDOW = 20
# "이전 대화를 기억하는 AI"를 만들려면 매번 과거 대화를 다시 보내주는 것


def _ndjson(payload: dict) -> str:
    """스트리밍 이벤트 1건을 NDJSON 한 줄(끝에 개행)로 직렬화."""
    return json.dumps(payload, ensure_ascii=False) + "\n"


@router.get("/messages", response_model=list[ChatMessageOut])
def list_messages(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessage]:
    """Return the latest `limit` messages in chronological order (oldest first)."""
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.id.desc())
        .limit(limit)
    )
    rows = list(db.execute(stmt).scalars())
    rows.reverse()
    return rows


@router.post("/messages")
def send_message(
    payload: ChatSendRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """유저 메시지를 저장한 뒤, AI 답변을 토큰 단위 NDJSON 스트림으로 흘려보낸다.

    스트림 이벤트(한 줄에 JSON 1개):
      {"type": "user",  "message": {...}}  — 유저 메시지 저장 완료
      {"type": "delta", "text": "..."}     — AI 답변 조각
      {"type": "done",  "message": {...}}  — AI 메시지 저장 완료
    """
    user_msg = ChatMessage(
        user_id=current_user.id, role=ChatRole.user, text=payload.text
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    history_stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.id.desc())
        .limit(CONTEXT_WINDOW)
    )
    recent = list(db.execute(history_stmt).scalars())
    recent.reverse()
    history = [{"role": m.role.value, "text": m.text} for m in recent]

    # 환자의 오늘 식단 + 최근 7일 평균을 스냅샷으로 만들어 system 메시지에
    # 끼울 준비. 요청 스코프의 db 세션이 살아있는 동안 미리 string 으로
    # 떠둔다(event_stream 안에서는 이미 닫혀 있을 수 있음).
    diet_context = build_diet_context(db, current_user.id)

    # event_stream() 은 이 함수가 응답을 반환한 *뒤에* 실행된다. 그때 요청
    # 스코프의 db 세션은 이미 닫혔을 수 있으므로, 넘길 값은 미리 평범한
    # dict/숫자로 빼두고 AI 메시지는 제너레이터 전용 세션으로 따로 저장한다.
    user_id = current_user.id
    user_event = _ndjson(
        {
            "type": "user",
            "message": ChatMessageOut.model_validate(user_msg).model_dump(
                mode="json"
            ),
        }
    )

    def event_stream():
        yield user_event

        chunks: list[str] = []
        for delta in chat_completion_stream(history, diet_context=diet_context):
            chunks.append(delta)
            yield _ndjson({"type": "delta", "text": delta})

        ai_text = "".join(chunks).strip() or CHAT_MOCK_RESPONSE

        with SessionLocal() as session:
            ai_msg = ChatMessage(
                user_id=user_id, role=ChatRole.ai, text=ai_text
            )
            session.add(ai_msg)
            session.commit()
            session.refresh(ai_msg)
            done_event = _ndjson(
                {
                    "type": "done",
                    "message": ChatMessageOut.model_validate(ai_msg).model_dump(
                        mode="json"
                    ),
                }
            )
        yield done_event

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.delete("/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Wipe the current user's chat history (e.g. '대화 초기화' 버튼용)."""
    db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id).delete()
    db.commit()
