"""Exercise malformed saved data and cross-session boundaries through public reads."""

import json
import sqlite3
from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import InvalidRecordError
from app.agent.persistence.operation_state import CheckpointState, NeedAssistant
from app.ai import UserMessage


@pytest.mark.parametrize("damage", ["pending", "custom", "compaction", "intent", "state_reference"])
def test_corrupt_saved_record_is_reported_instead_of_silently_read(tmp_path, damage):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    other = store.create_session()
    foreign_id = store.append_message(other.id, UserMessage(content="Other", timestamp=1))
    entry_id = store.append_message(session.id, UserMessage(content="Hello", timestamp=1))
    op = store.accept_operation(session.id, [])
    store.close()
    with sqlite3.connect(path) as conn:
        if damage == "pending":
            value = {
                "message": {
                    "role": "assistant",
                    "content": [],
                    "provider": "sample",
                    "api": "openai-completions",
                    "model": "small",
                    "timestamp": 1,
                    "stop_reason": "pending",
                }
            }
            conn.execute(
                "UPDATE session_entries SET payload_json=? WHERE id=?",
                (json.dumps(value), entry_id),
            )
        elif damage in ("custom", "compaction"):
            conn.execute(
                "UPDATE session_entries SET type=?, payload_json='{}' WHERE id=?",
                (damage, entry_id),
            )
        elif damage == "intent":
            conn.execute("UPDATE operations SET intent_json='[]' WHERE id=?", (op.id,))
        else:
            state = CheckpointState(continuation=NeedAssistant(), trigger_entry_id=foreign_id)
            conn.execute(
                "UPDATE operations SET state_json=? WHERE id=?", (state.model_dump_json(), op.id)
            )
    store = SQLiteStore(path)
    with pytest.raises(InvalidRecordError):
        if damage in ("intent", "state_reference"):
            store.get_operation(op.id)
        else:
            store.list_entries(session.id)
    store.close()


@pytest.mark.parametrize(
    "table, extra",
    [
        ("compaction_preparations", {"preparation_json": "{}"}),
        (
            "assistant_message_frames",
            {"response_entry_id": "future", "frame_index": 0, "frame_json": "{}"},
        ),
        ("usage_ledger", {"usage_json": "{}", "adjustment": 0}),
    ],
)
def test_common_child_cannot_omit_its_operations_session(tmp_path, table, extra):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    op = store.accept_operation(session.id, [])
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        fields = {"id": str(uuid4()), "session_id": None, "operation_id": op.id, **extra}
        sql = f"INSERT INTO {table} ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})"
        with pytest.raises(sqlite3.IntegrityError, match="session mismatch"):
            conn.execute(sql, tuple(fields.values()))
    store.close()


def test_state_references_cannot_claim_another_sessions_history(tmp_path):
    from app.agent.persistence.operation_state import (
        AssistantPendingState,
        GenerationConfiguration,
        GenerationContext,
    )

    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    other = store.create_session()
    foreign_id = store.append_message(other.id, UserMessage(content="Other", timestamp=1))
    op = store.accept_operation(session.id, [])
    with pytest.raises(InvalidRecordError):
        store.transition(
            op.id,
            expected=op.state,
            state=CheckpointState(continuation=NeedAssistant(), trigger_entry_id=foreign_id),
        )
    pending = AssistantPendingState(
        generation_context=GenerationContext(
            step_id=str(uuid4()),
            trigger_entry_id=None,
            configuration=GenerationConfiguration(provider="sample", model_id="small"),
        ),
        attempt=1,
        response_entry_id=foreign_id,
        usage_id=str(uuid4()),
        intended_output_limit=10,
        context_window=100,
    )
    with pytest.raises(InvalidRecordError):
        store.transition(op.id, expected=op.state, state=pending)
    valid = pending.model_copy(update={"response_entry_id": str(uuid4())})
    store.transition(op.id, expected=op.state, state=valid)
    assert store.get_operation(op.id).state == valid
    store.close()
