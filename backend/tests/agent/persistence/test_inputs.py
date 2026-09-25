"""Verify durable input queues and atomic movement into formal history."""

from app.agent.persistence import SQLiteStore
from app.ai import UserMessage


def test_inputs_keep_identity_order_and_withdrawal_results(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    ids = [
        store.enqueue_input(session.id, kind, UserMessage(content=kind, timestamp=1)).id
        for kind in ("steer", "follow_up", "next_run", "write")
    ]
    custom = store.enqueue_custom(session.id, "note", {"value": 7})
    store.close()
    store = SQLiteStore(path)
    assert [item.id for item in store.list_inputs(session.id)] == [*ids, custom.id]
    assert store.withdraw_input(session.id, ids[1]) == "cancelled"
    assert store.withdraw_input(session.id, ids[1]) == "not_found"
    operation = store.accept_operation(
        session.id,
        [UserMessage(content="direct", timestamp=2)],
        input_ids=[custom.id, ids[2], ids[0]],
    )
    entries = store.list_entries(session.id)
    assert [entry.id for entry in entries[:3]] == [ids[0], ids[2], custom.id]
    assert entries[2].type == "custom" and entries[2].message is None
    assert operation.intent["prompt_entry_ids"] == [entries[-1].id]
    assert store.withdraw_input(session.id, ids[0]) == "already_consumed"
    assert [item.id for item in store.list_inputs(session.id)] == [ids[3]]
    store.finish_operation(operation.id, expected=operation.state, status="completed")
    assert [item.id for item in store.list_inputs(session.id)] == [ids[3]]
    store.close()


def test_busy_append_queues_write_and_failed_consumption_keeps_every_input(tmp_path):
    import sqlite3

    import pytest

    from app.agent.persistence.errors import StorageError

    path = tmp_path / "agent.sqlite3"
    now = [10]
    store = SQLiteStore(path, clock=lambda: now[0])
    session = store.create_session()
    custom_id = store.append_custom(session.id, "note", {"ignored_by_context": True})
    assert store.get_session(session.id).last_activity_at == 10
    operation = store.accept_operation(session.id, [])
    now[0] = 20
    queued_id = store.append_message(session.id, UserMessage(content="later", timestamp=1))
    assert store.get_session(session.id).last_activity_at == 10
    assert [entry.id for entry in store.list_entries(session.id)] == [custom_id]
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TRIGGER fail_consume BEFORE UPDATE OF state_json ON operations
            BEGIN SELECT RAISE(ABORT, 'state commit failure'); END;
        """)
    with pytest.raises(StorageError):
        store.consume_inputs(
            operation.id, [queued_id], expected=operation.state, next_state=operation.state
        )
    store.close()
    store = SQLiteStore(path)
    assert [item.id for item in store.list_inputs(session.id)] == [queued_id]
    assert [entry.id for entry in store.list_entries(session.id)] == [custom_id]
    with sqlite3.connect(path) as conn:
        conn.execute("DROP TRIGGER fail_consume")
    store.consume_inputs(
        operation.id, [queued_id], expected=operation.state, next_state=operation.state
    )
    assert store.get_entry(queued_id).message.content == "later"
    assert store.get_session(session.id).last_activity_at > 10
    store.close()
