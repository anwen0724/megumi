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


def test_request_configuration_cannot_persist_credentials(tmp_path):
    from uuid import uuid4

    from app.agent.persistence.errors import InvalidRecordError
    from app.agent.persistence.operation_state import (
        AssistantReadyState,
        GenerationConfiguration,
        GenerationContext,
    )

    store = SQLiteStore(tmp_path / "agent.sqlite3")
    session = store.create_session()
    op = store.accept_operation(session.id, [])
    valid = AssistantReadyState(
        next_attempt=1,
        generation_context=GenerationContext(
            step_id=str(uuid4()),
            trigger_entry_id=None,
            configuration=GenerationConfiguration(provider="sample", model_id="small"),
            stream_options={"temperature": 0.5},
        ),
    )
    store.transition(op.id, expected=op.state, state=valid)
    invalid = valid.model_copy(deep=True)
    invalid.generation_context.stream_options["api_key"] = "synthetic-secret"
    with pytest.raises(InvalidRecordError):
        store.transition(op.id, expected=valid, state=invalid)
    assert store.get_operation(op.id).state == valid
    store.close()
