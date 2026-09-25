"""Verify atomic acceptance, terminal results and separate release."""

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import BusyError
from app.ai import UserMessage


def test_operation_acceptance_and_release_survive_reopening(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    operation = store.accept_operation(session.id, [UserMessage(content="Hello", timestamp=1)])
    entries = store.list_entries(session.id)
    assert len(entries) == 1
    assert entries[0].operation_id == operation.id
    assert operation.intent == {"prompt_entry_ids": [entries[0].id]}
    assert operation.base_entry_id is None
    with pytest.raises(BusyError):
        store.accept_operation(session.id, [UserMessage(content="Not accepted", timestamp=2)])
    assert len(store.list_entries(session.id)) == 1
    store.finish_operation(operation.id, expected=operation.state, status="completed")
    store.close()
    store = SQLiteStore(path)
    result = store.get_operation(operation.id)
    assert result.result_status == "completed"
    assert result.state is None
    assert result.final_entry_id == entries[0].id
    assert result.released_at is None
    with pytest.raises(BusyError):
        store.archive_session(session.id)
    with pytest.raises(BusyError):
        store.delete_session(session.id)
    store.release_operation(operation.id)
    next_operation = store.accept_operation(session.id, [])
    assert next_operation.base_entry_id == entries[0].id
    store.close()
