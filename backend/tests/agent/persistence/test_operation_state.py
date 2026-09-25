"""Guard phase transitions against stale writers and malformed state."""

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import StaleWriteError
from app.agent.persistence.operation_state import StartingState


def test_state_commit_is_isolated_and_stale_writer_cannot_finish(tmp_path):
    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    operation = store.accept_operation(session.id, [])
    next_state = StartingState(
        settings=operation.state.settings.model_copy(update={"tool_execution": "sequential"})
    )
    store.transition(operation.id, expected=operation.state, state=next_state)
    with pytest.raises(StaleWriteError):
        store.finish_operation(operation.id, expected=operation.state, status="completed")
    saved = store.get_operation(operation.id)
    assert saved.state == next_state
    assert saved.result_status is None
    store.close()
