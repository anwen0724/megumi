"""Verify tool effects and ordered durable results through the actual Harness."""

from dataclasses import replace

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult
from app.agent.persistence import SQLiteStore
from app.agent.session import Session
from app.ai import CallOptions, Models, TextContent, ToolCall, Usage
from app.ai.api.openai_runtime import OpenAIProtocol


class ToolReplyAdapter(OpenAIProtocol):
    options_type = CallOptions

    def __init__(self):
        self.requests = []

    async def _produce_simple(self, **call):
        transcript = call["transcript"]
        self.requests.append(transcript)
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        if len(self.requests) == 1:
            writer.partial.content.extend(
                [
                    TextContent(text="Checking"),
                    ToolCall(id="remote-tool", name="lookup", arguments={"city": "Beijing"}),
                ]
            )
            reason = "tool_use"
        else:
            writer.partial.content.append(TextContent(text="Sunny"))
            reason = "stop"
        writer.partial.usage = Usage(input=2, output=3, total_tokens=5)
        writer.emit({"type": "done", "reason": reason, "message": writer.partial})

    async def _produce(self, **call):
        await self._produce_simple(**call)


@pytest.mark.asyncio
async def test_tool_intent_precedes_effect_and_results_survive_reopen(
    tmp_path, provider, monkeypatch
):
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    saved = store.create_session()
    observed = []

    async def execute(call_id, arguments, update, context, invocation):
        rows = store.list_tools(invocation.operation_id)
        observed.append(
            (rows[0].source_index, rows[0].status, rows[0].arguments, rows[0].replay_policy)
        )
        return AgentToolResult(content=[TextContent(text="Weather: sunny")], usage=Usage(input=1))

    adapter = ToolReplyAdapter()
    models = Models([replace(provider, api=adapter)])
    try:
        tool = AgentTool(
            name="lookup", description="Lookup", parameters={"type": "object"}, execute=execute
        )
        harness = AgentHarness(
            models, provider.get_models()[0], tools=[tool], session=Session(store, saved.id)
        )
        result = await harness.prompt("Weather")
        assert result.status == "completed", result.error_message
        assert observed == [(1, "effect_pending", {"city": "Beijing"}, "never")]
        store.close()
        store = SQLiteStore(path)
        entries = store.list_entries(saved.id)
        assert [entry.message.role for entry in entries] == [
            "user",
            "assistant",
            "toolResult",
            "assistant",
        ]
        assert entries[2].message.tool_call_id == "remote-tool"
        assert entries[2].id != "remote-tool"
        assert all(entry.operation_id == result.operation_id for entry in entries)
        assert store.list_tools(result.operation_id) == []
        assert len(store.list_usage(session_id=saved.id)) == 3
        assert adapter.requests[1].messages[-1] == entries[2].message
    finally:
        await models.aclose()
        store.close()


@pytest.mark.asyncio
async def test_tool_checkpoint_memos_and_expired_handle(tmp_path, provider, monkeypatch):
    import asyncio

    from app.agent.persistence.errors import StaleWriteError

    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    store = SQLiteStore(tmp_path / "agent.sqlite3")
    saved = store.create_session()
    handles = []
    observed = []

    async def execute(call_id, arguments, update, context, invocation):
        handles.append(invocation)
        update(AgentToolResult(content=[TextContent(text="visible only")]))
        row = store.list_tools(invocation.operation_id)[0]
        observed.append(row.partial_result is None)
        invocation.checkpoint(AgentToolResult(content=[TextContent(text="durable")]))
        invocation.checkpoint(AgentToolResult(content=[TextContent(text="latest")]))

        async def put(key, value):
            invocation.set_memo(key, value)

        await asyncio.gather(put("page", 2), put("cursor", "next"))
        assert invocation.get_memo("page") == 2
        assert invocation.get_memo("cursor") == "next"
        invocation.delete_memo("page")
        assert invocation.get_memo("page") is None
        row = store.get_tool(row.id)
        observed.append(row.partial_result["content"][0]["text"])
        observed.append(row.memos)
        return AgentToolResult(content=[TextContent(text="complete")])

    adapter = ToolReplyAdapter()
    models = Models([replace(provider, api=adapter)])
    try:
        tool = AgentTool(
            name="lookup", description="Lookup", parameters={"type": "object"}, execute=execute
        )
        harness = AgentHarness(
            models, provider.get_models()[0], tools=[tool], session=Session(store, saved.id)
        )

        async def check_closed(_context):
            with pytest.raises(StaleWriteError):
                handles[0].set_memo("after_execute", True)

        harness.hooks.on("after_tool", check_closed)
        result = await harness.prompt("Weather")
        assert observed == [True, "latest", {"cursor": "next"}]
        assert result.status == "completed"
        with pytest.raises(StaleWriteError):
            handles[0].set_memo("late", True)
        assert store.list_tools(result.operation_id) == []
    finally:
        await models.aclose()
        store.close()


@pytest.mark.asyncio
async def test_checkpoint_storage_error_is_not_a_model_visible_tool_error(
    tmp_path,
    provider,
    monkeypatch,
):
    import sqlite3

    from app.agent.persistence.errors import StorageError

    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    path = tmp_path / "agent.sqlite3"
    store = SQLiteStore(path)
    saved = store.create_session()
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF partial_result_json ON tool_executions
            WHEN NEW.partial_result_json IS NOT NULL
            BEGIN SELECT RAISE(ABORT, 'checkpoint failure'); END;
        """)
    effects = []

    async def execute(call_id, arguments, update, context, invocation):
        effects.append(call_id)
        invocation.checkpoint(AgentToolResult(content=[TextContent(text="progress")]))
        return AgentToolResult(content=[TextContent(text="never reached")])

    adapter = ToolReplyAdapter()
    models = Models([replace(provider, api=adapter)])
    try:
        tool = AgentTool(
            name="lookup", description="Lookup", parameters={"type": "object"}, execute=execute
        )
        harness = AgentHarness(
            models, provider.get_models()[0], tools=[tool], session=Session(store, saved.id)
        )
        with pytest.raises(StorageError, match="checkpoint"):
            await harness.prompt("Weather")
        assert effects == ["remote-tool"]
        assert len(adapter.requests) == 1
        operation = store.active_operation(saved.id)
        assert operation.result_status is None
        assert store.list_tools(operation.id)[0].status == "effect_pending"
        assert [entry.message.role for entry in store.list_entries(saved.id)] == [
            "user",
            "assistant",
        ]
    finally:
        await models.aclose()
        store.close()
