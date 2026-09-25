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
