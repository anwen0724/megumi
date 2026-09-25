"""Save immutable compression materials without running a summarizer."""

from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import ConflictError
from app.agent.persistence.operation_state import CheckpointState, NeedAssistant
from app.ai import UserMessage


def preparation():
    return {
        "messages_to_summarize": [{"role": "user", "content": "Original question", "timestamp": 1}],
        "turn_prefix_messages": [
            {
                "role": "toolResult",
                "tool_call_id": "lookup",
                "tool_name": "search",
                "content": [{"type": "text", "text": "Long result " * 10000}],
                "is_error": False,
                "timestamp": 2,
            }
        ],
        "retained_tail": [{"role": "user", "content": "Continue", "timestamp": 3}],
        "is_split_turn": True,
        "tokens_before": 20000,
        "previous_summary": "Earlier context",
        "file_ops": {"read": ["notes.md"], "written": [], "edited": []},
        "settings": {"enabled": True, "reserve_tokens": 2000, "keep_recent_tokens": 3000},
    }


def test_preparation_is_immutable_complete_and_survives_reopen(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    operation = store.accept_operation(
        session.id, [UserMessage(content="Original question", timestamp=1)]
    )
    task_id = str(uuid4())
    data = preparation()
    state = CheckpointState(continuation=NeedAssistant(), trigger_entry_id=None)
    saved = store.save_preparation(
        operation.id,
        expected=operation.state,
        preparation_id=task_id,
        preparation=data,
        next_state=state,
    )
    data["turn_prefix_messages"].clear()
    store.close()
    store = SQLiteStore(path)
    restored = store.get_preparation(task_id)
    assert restored.operation_id == operation.id
    assert restored.preparation == saved.preparation
    assert restored.preparation.turn_prefix_messages[0].content[0].text == "Long result " * 10000
    assert store.get_operation(operation.id).state == state
    with pytest.raises(ConflictError):
        store.save_preparation(
            operation.id,
            expected=state,
            preparation_id=task_id,
            preparation=data,
            next_state=state,
        )
    second_id = str(uuid4())
    store.save_preparation(
        operation.id,
        expected=state,
        preparation_id=second_id,
        preparation=preparation(),
        next_state=state,
    )
    assert [item.id for item in store.list_preparations(operation.id)] == [task_id, second_id]
    store.close()


def test_retry_and_summary_phases_preserve_controls_and_material_links(tmp_path):
    import json
    from uuid import uuid4

    from app.agent.persistence.codec import decode_state

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    op = store.accept_operation(session.id, [])
    task_id = str(uuid4())
    config = {"provider": "sample", "model_id": "small"}
    generation = {"step_id": str(uuid4()), "trigger_entry_id": None, "configuration": config}
    task = {
        "task_id": task_id,
        "reason": "threshold",
        "boundary": {
            "kind": "checkpoint",
            "continuation": {"kind": "need_assistant"},
            "trigger_entry_id": None,
        },
    }
    summary = {"result_entry_id": str(uuid4()), "configuration": config}
    phases = [
        {
            "at": "assistant.retry_wait",
            "generation_context": generation,
            "next_attempt": 2,
            "not_before": 500,
            "error_message": "busy",
        },
        {"at": "summary.deciding", "task": task},
        {"at": "summary.ready", "task": task, "summary_context": summary, "next_attempt": 1},
        {
            "at": "summary.effect_pending",
            "task": task,
            "summary_context": summary,
            "attempt": 1,
            "request": {"index": 0, "usage_id": str(uuid4())},
            "usage_ids": [],
        },
        {
            "at": "summary.retry_wait",
            "task": task,
            "summary_context": summary,
            "next_attempt": 2,
            "not_before": 600,
            "error_message": "retry",
        },
    ]
    for value in phases:
        value["control"] = {"status": "cancel_requested", "requested_at": 123}
        state = decode_state(json.dumps(value))
        if value["at"] == "summary.deciding":
            store.save_preparation(
                op.id,
                expected=op.state,
                preparation_id=task_id,
                preparation=preparation(),
                next_state=state,
            )
        else:
            store.transition(op.id, expected=op.state, state=state)
        store.close()
        store = SQLiteStore(path)
        op = store.get_operation(op.id)
        assert op.state == state
        assert op.state.control.requested_at == 123
    store.close()


@pytest.mark.parametrize("kind", ["run", "compaction"])
def test_summary_requests_are_accounted_once_and_preparation_lives_until_terminal(tmp_path, kind):
    from app.agent.persistence.operation_state import (
        GenerationConfiguration,
        StandaloneBoundary,
        SummaryContext,
        SummaryPendingState,
        SummaryRequest,
        SummaryTask,
    )
    from app.ai import Usage

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    store.append_message(session.id, UserMessage(content="Keep original", timestamp=1))
    op = store.accept_operation(session.id, [], kind=kind)
    task_id, result_id = str(uuid4()), str(uuid4())
    pending = SummaryPendingState(
        task=SummaryTask(task_id=task_id, reason="manual", boundary=StandaloneBoundary()),
        summary_context=SummaryContext(
            result_entry_id=result_id,
            configuration=GenerationConfiguration(provider="sample", model_id="small"),
        ),
        attempt=1,
        request=SummaryRequest(index=0, usage_id=str(uuid4())),
    )
    store.save_preparation(
        op.id,
        expected=op.state,
        preparation_id=task_id,
        preparation=preparation(),
        next_state=pending,
    )
    first = store.commit_summary_usage(op.id, expected=pending, usage=Usage(input=1, output=2))
    second_pending = first.state.model_copy(
        update={"request": SummaryRequest(index=1, usage_id=str(uuid4()))}
    )
    store.transition(op.id, expected=first.state, state=second_pending)
    second = store.commit_summary_usage(
        op.id, expected=second_pending, usage=Usage(input=2, output=3)
    )
    next_state = CheckpointState(continuation=NeedAssistant(), trigger_entry_id=result_id)
    store.commit_compaction(
        op.id,
        expected=second.state,
        summary="Saved summary",
        retained_tail=[UserMessage(content="Continue", timestamp=3)],
        tokens_before=20000,
        usage=Usage(input=3, output=5),
        from_hook=False,
        next_state=next_state,
    )
    store.close()
    store = SQLiteStore(path)
    entries = store.list_entries(session.id)
    assert [entry.type for entry in entries] == ["message", "compaction"]
    assert entries[0].message.content == "Keep original"
    assert entries[1].id == result_id != task_id
    assert entries[1].payload["summary"] == "Saved summary"
    assert entries[1].payload["retained_tail"][0]["content"] == "Continue"
    assert store.summarize_usage(session_id=session.id).tokens.input == 3
    assert len(store.list_usage(session_id=session.id)) == 2
    assert len(store.list_preparations(op.id)) == 1
    store.finish_operation(op.id, expected=next_state, status="completed")
    assert store.list_preparations(op.id) == []
    assert len(store.list_entries(session.id)) == 2
    assert len(store.list_usage(session_id=session.id)) == 2
    store.close()


def test_direct_hook_summary_saves_instructions_and_usage_with_result(tmp_path):
    from app.agent.persistence.operation_state import (
        GenerationConfiguration,
        StandaloneBoundary,
        SummaryContext,
        SummaryReadyState,
        SummaryTask,
    )
    from app.ai import Usage

    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    op = store.accept_operation(
        session.id,
        [],
        kind="compaction",
        custom_instructions="Keep decisions",
    )
    assert op.intent == {"custom_instructions": "Keep decisions"}
    ready = SummaryReadyState(
        task=SummaryTask(
            task_id=str(uuid4()),
            reason="manual",
            custom_instructions="Keep decisions",
            boundary=StandaloneBoundary(),
        ),
        summary_context=SummaryContext(
            result_entry_id=str(uuid4()),
            configuration=GenerationConfiguration(provider="sample", model_id="small"),
        ),
        next_attempt=1,
    )
    store.save_preparation(
        op.id,
        expected=op.state,
        preparation_id=ready.task.task_id,
        preparation=preparation(),
        next_state=ready,
    )
    store.commit_compaction(
        op.id,
        expected=ready,
        summary="Decisions",
        retained_tail=[],
        tokens_before=100,
        usage=Usage(input=10),
        direct_usage_id=str(uuid4()),
        from_hook=True,
        next_state=CheckpointState(continuation=NeedAssistant(), trigger_entry_id=None),
    )
    usage = store.list_usage(session_id=session.id)
    assert len(usage) == 1
    assert usage[0].entry_id == ready.summary_context.result_entry_id
    assert usage[0].usage.input == 10
    store.close()
