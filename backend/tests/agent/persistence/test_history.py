"""Verify full AI records and atomic rejection through public storage APIs."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import ConflictError, InvalidRecordError
from app.ai import AssistantMessage, TextContent, ThinkingContent, Usage, UsageCost, UserMessage


def test_rich_history_roundtrip_and_duplicate_identity(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    message = AssistantMessage(
        content=[
            TextContent(text="answer", text_signature="text-signature"),
            ThinkingContent(thinking="reason", thinking_signature="think-signature"),
        ],
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=42,
        stop_reason="stop",
        response_id="remote-response",
        usage=Usage(input=3, output=5, cost=UsageCost(total=Decimal("0.00000123"))),
    )
    entry_id = str(uuid4())
    store.append_message(session.id, message, entry_id=entry_id)
    store.append_message(session.id, message, entry_id=entry_id)
    store.close()
    store = SQLiteStore(path)
    entry = store.get_entry(entry_id)
    assert entry.message == message
    entry.message.content[0].text = "caller mutation"
    assert store.get_entry(entry_id).message.content[0].text == "answer"
    assert len(store.list_entries(session.id)) == 1
    with pytest.raises(ConflictError):
        store.append_message(
            session.id, UserMessage(content="different", timestamp=1), entry_id=entry_id
        )
    store.close()


def test_invalid_second_input_rolls_back_acceptance_and_first_input(tmp_path):
    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    pending = AssistantMessage(
        content=[],
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=1,
    )
    with pytest.raises(InvalidRecordError):
        store.accept_operation(session.id, [UserMessage(content="valid", timestamp=1), pending])
    assert store.list_entries(session.id) == []
    assert store.active_operation(session.id) is None
    assert store.list_operations(session.id) == []
    store.close()
