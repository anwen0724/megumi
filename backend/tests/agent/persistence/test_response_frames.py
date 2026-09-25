"""Persist progress through existing AI frame semantics and atomic finalization."""

from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import StaleWriteError
from app.agent.persistence.operation_state import (
    AssistantPendingState,
    CheckpointState,
    GenerationConfiguration,
    GenerationContext,
    MayFinish,
)
from app.ai import AssistantMessage, TextContent, Usage, reduce_assistant_message_frames


def pending_state():
    return AssistantPendingState(
        generation_context=GenerationContext(
            step_id=str(uuid4()),
            trigger_entry_id=None,
            configuration=GenerationConfiguration(provider="sample", model_id="small"),
        ),
        response_entry_id=str(uuid4()),
        usage_id=str(uuid4()),
        attempt=1,
        intended_output_limit=100,
        context_window=1000,
    )


def test_progress_survives_reopen_and_final_response_removes_frames(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    operation = store.accept_operation(session.id, [])
    pending = pending_state()
    store.transition(operation.id, expected=operation.state, state=pending)
    partial = AssistantMessage(
        content=[],
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=1,
    )
    frames = [
        {"type": "start", "partial": partial},
        {"type": "text_start", "content_index": 0, "content": TextContent(text="Part")},
        {"type": "text_delta", "content_index": 0, "delta": " two"},
    ]
    for frame in frames:
        store.append_frame(operation.id, pending.response_entry_id, frame)
    store.close()
    store = SQLiteStore(path)
    restored = reduce_assistant_message_frames(
        store.read_frames(operation.id, pending.response_entry_id)
    )
    assert restored.content == [TextContent(text="Part two")]
    final = AssistantMessage(
        content=[TextContent(text="Complete")],
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=1,
        stop_reason="stop",
        usage=Usage(input=1, output=1),
    )
    checkpoint = CheckpointState(
        latest_assistant_entry_id=pending.response_entry_id,
        trigger_entry_id=pending.response_entry_id,
        continuation=MayFinish(),
    )
    store.commit_response(operation.id, expected=pending, message=final, next_state=checkpoint)
    assert store.read_frames(operation.id, pending.response_entry_id) == []
    assert store.get_entry(pending.response_entry_id).message == final
    assert store.get_operation(operation.id).state == checkpoint
    assert len(store.list_usage(session_id=session.id)) == 1
    with pytest.raises(StaleWriteError):
        store.append_frame(operation.id, pending.response_entry_id, frames[-1])
    store.close()
