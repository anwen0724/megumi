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
