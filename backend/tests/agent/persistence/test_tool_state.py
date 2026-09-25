"""Verify durable out-of-order outcomes with in-order history publication."""

from uuid import uuid4

import pytest

from app.agent.persistence import SQLiteStore
from app.agent.persistence.errors import InvalidRecordError
from app.agent.persistence.operation_state import (
    AssistantPendingState,
    GenerationConfiguration,
    GenerationContext,
    ToolBatch,
    ToolsState,
)
from app.ai import AssistantMessage, TextContent, ToolCall, ToolResultMessage, Usage


def setup_batch(store, session_id):
    operation = store.accept_operation(session_id, [])
    configuration = GenerationConfiguration(provider="sample", model_id="small")
    pending = AssistantPendingState(
        generation_context=GenerationContext(
            step_id=str(uuid4()),
            trigger_entry_id=None,
            configuration=configuration,
        ),
        response_entry_id=str(uuid4()),
        usage_id=str(uuid4()),
        attempt=1,
        intended_output_limit=100,
        context_window=1000,
    )
    store.transition(operation.id, expected=operation.state, state=pending)
    message = AssistantMessage(
        content=[
            TextContent(text="Tools"),
            ToolCall(id="a", name="lookup", arguments={}),
            ToolCall(id="b", name="lookup", arguments={}),
        ],
        provider="sample",
        api="openai-completions",
        model="small",
        timestamp=1,
        stop_reason="tool_use",
    )
    tools = ToolsState(
        latest_assistant_entry_id=pending.response_entry_id,
        batch=ToolBatch(
            assistant_entry_id=pending.response_entry_id,
            configuration=configuration,
            turn_id=str(uuid4()),
        ),
    )
    store.commit_response(operation.id, expected=pending, message=message, next_state=tools)
    return operation.id, store.list_tools(operation.id)


def outcome(call_id, *, error=False):
    return ToolResultMessage(
        tool_call_id=call_id,
        tool_name="lookup",
        content=[TextContent(text=call_id)],
        is_error=error,
        timestamp=2,
        usage=Usage(input=1),
    )


def test_later_outcome_persists_without_publishing_ahead_of_first(tmp_path):
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    operation_id, tools = setup_batch(store, session.id)
    assert [tool.source_index for tool in tools] == [1, 2]
    store.start_tool(tools[0].id, {"actual": 1}, "safe")
    # A precheck rejection does not fabricate a tool effect.
    store.save_tool_outcome(tools[1].id, outcome("b", error=True), terminate=False)
    assert store.publish_tool_results(operation_id) == []
    store.close()
    store = SQLiteStore(path)
    assert store.get_tool(tools[1].id).status == "outcome_ready"
    assert len(store.list_entries(session.id)) == 1
    with pytest.raises(InvalidRecordError):
        store.save_tool_outcome(tools[0].id, outcome("different"), terminate=False)
    store.save_tool_outcome(tools[0].id, outcome("a"), terminate=False)
    published = store.publish_tool_results(operation_id)
    assert [entry.id for entry in published] == [tool.id for tool in tools]
    assert [entry.message.tool_call_id for entry in published] == ["a", "b"]
    assert all(tool.arguments is None for tool in store.list_tools(operation_id))
    assert len(store.list_usage(session_id=session.id)) == 3
    saved = store.get_operation(operation_id)
    store.finish_operation(operation_id, expected=saved.state, status="completed")
    assert store.list_tools(operation_id) == []
    assert len(store.list_entries(session.id)) == 3
    store.close()


@pytest.mark.parametrize("boundary", ["publication", "terminal"])
def test_failed_tool_publication_or_cleanup_rolls_back_all_facts(tmp_path, boundary):
    import sqlite3

    from app.agent.persistence.errors import StorageError
    from app.ai import UserMessage

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    op_id, tools = setup_batch(store, session.id)
    store.save_tool_outcome(tools[0].id, outcome("a"), terminate=False)
    store.save_tool_outcome(tools[1].id, outcome("b"), terminate=False)
    store.enqueue_input(session.id, "next_run", UserMessage(content="Later", timestamp=3))
    before = store.get_operation(op_id)
    if boundary == "publication":
        trigger = """
            CREATE TRIGGER fail_write BEFORE UPDATE OF status ON tool_executions
            WHEN NEW.status='completed'
            BEGIN SELECT RAISE(ABORT, 'publication failed'); END;
        """
    else:
        trigger = """
            CREATE TRIGGER fail_write BEFORE DELETE ON tool_executions
            BEGIN SELECT RAISE(ABORT, 'cleanup failed'); END;
        """
    with sqlite3.connect(path) as conn:
        conn.executescript(trigger)
    with pytest.raises(StorageError):
        if boundary == "publication":
            store.publish_tool_results(op_id)
        else:
            store.finish_operation(op_id, expected=before.state, status="completed")
    store.close()
    store = SQLiteStore(path)
    assert store.get_operation(op_id) == before
    assert [tool.status for tool in store.list_tools(op_id)] == ["outcome_ready", "outcome_ready"]
    assert len(store.list_entries(session.id)) == 1
    assert len(store.list_usage(session_id=session.id)) == 1
    assert len(store.list_inputs(session.id)) == 1
    with sqlite3.connect(path) as conn:
        conn.execute("DROP TRIGGER fail_write")
    store.publish_tool_results(op_id)
    current = store.get_operation(op_id)
    store.finish_operation(op_id, expected=current.state, status="completed")
    assert len(store.list_entries(session.id)) == 3
    assert len(store.list_usage(session_id=session.id)) == 3
    assert len(store.list_inputs(session.id)) == 1
    with pytest.raises(StorageError):
        store.save_tool_outcome(tools[0].id, outcome("a"), terminate=False)
    store.close()


def test_delete_idle_session_removes_owned_facts_and_preserves_other_owners(tmp_path):
    import sqlite3

    from app.agent.persistence.errors import BusyError, NotFoundError
    from app.ai import UserMessage

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    other = store.create_session("Keep")
    other_entry = store.append_message(other.id, UserMessage(content="Keep", timestamp=1))
    op_id, tools = setup_batch(store, session.id)
    for tool, call_id in zip(tools, ["a", "b"], strict=True):
        store.save_tool_outcome(tool.id, outcome(call_id), terminate=False)
    store.publish_tool_results(op_id)
    state = store.get_operation(op_id).state
    store.finish_operation(op_id, expected=state, status="completed")
    with pytest.raises(BusyError):
        store.delete_session(session.id)
    store.release_operation(op_id)
    op2 = store.accept_operation(session.id, [UserMessage(content="Again", timestamp=2)])
    store.finish_operation(op2.id, expected=op2.state, status="declined")
    store.release_operation(op2.id)
    store.enqueue_input(session.id, "next_run", UserMessage(content="Pending", timestamp=3))
    unbound_id = str(uuid4())
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute(
            "INSERT INTO operations(id, kind, intent_json, state_json, accepted_at) "
            "VALUES (?, 'run', ?, ?, 1)",
            (unbound_id, '{"prompt_entry_ids":[]}', op2.state.model_dump_json()),
        )
    store.record_usage(str(uuid4()), Usage(input=7), operation_id=unbound_id)
    store.delete_session(session.id)
    store.close()
    store = SQLiteStore(path)
    with pytest.raises(NotFoundError):
        store.get_session(session.id)
    with pytest.raises(NotFoundError):
        store.get_operation(op_id)
    with pytest.raises(NotFoundError):
        store.get_entry(tools[0].id)
    assert store.get_entry(other_entry).message.content == "Keep"
    assert store.get_operation(unbound_id).session_id is None
    assert store.list_usage(operation_id=unbound_id)[0].usage.input == 7
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        for table in ["session_inputs", "usage_ledger"]:
            assert (
                conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE session_id=?", (session.id,)
                ).fetchone()[0]
                == 0
            )
    store.close()


@pytest.mark.parametrize(
    "column, payload",
    [
        ("memos_json", "[]"),
        ("partial_result_json", "{}"),
        ("arguments_json", "[]"),
    ],
)
def test_corrupt_tool_materials_fail_public_reads(tmp_path, column, payload):
    import sqlite3

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    op_id, tools = setup_batch(store, session.id)
    store.start_tool(tools[0].id, {}, "never")
    with sqlite3.connect(path) as conn:
        conn.execute(f"UPDATE tool_executions SET {column}=? WHERE id=?", (payload, tools[0].id))
    with pytest.raises(InvalidRecordError):
        store.list_tools(op_id)
    store.close()


def test_saved_tool_source_must_still_identify_an_actual_tool_call(tmp_path):
    import sqlite3

    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    session = store.create_session()
    op_id, tools = setup_batch(store, session.id)
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE tool_executions SET source_index=0 WHERE id=?", (tools[0].id,))
    with pytest.raises(InvalidRecordError):
        store.list_tools(op_id)
    store.close()
