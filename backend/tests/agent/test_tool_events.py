"""Verify observable tool progress and listener isolation."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult
from app.ai import CallOptions, Models, Provider, TextContent, ToolCall, ToolDefinition


class OneToolAdapter:
    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        self.requests.append(call["transcript"])
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        if len(self.requests) == 1:
            writer.partial.content.append(ToolCall(id="call-1", name="lookup", arguments={}))
            reason = "tool_use"
        else:
            writer.partial.content.append(TextContent(text="done"))
            reason = "stop"
        writer.emit({"type": "done", "reason": reason, "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


def lookup_tool(execute: object) -> AgentTool:
    return AgentTool(
        definition=ToolDefinition(
            name="lookup", description="Lookup", parameters={"type": "object"}
        ),
        execute=execute,
    )


@pytest.mark.asyncio
async def test_progress_events_do_not_enter_history_and_late_updates_are_ignored(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = OneToolAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    recorded: list[object] = []
    saved_update: list[object] = []

    async def execute(_id: str, _args: object, update: object, *_rest: object) -> AgentToolResult:
        saved_update.append(update)
        update(AgentToolResult(content=[TextContent(text="one")]))
        update(AgentToolResult(content=[TextContent(text="two")]))
        return AgentToolResult(content=[TextContent(text="final")])

    harness = AgentHarness(models, provider.models[0], tools=[lookup_tool(execute)])
    for kind in ("tool_start", "tool_update", "tool_end"):
        harness.events.on(kind, recorded.append)
    try:
        outcome = await harness.prompt("lookup")
        assert outcome.status == "completed"
        assert [event.type for event in recorded] == [
            "tool_start",
            "tool_update",
            "tool_update",
            "tool_end",
        ]
        assert all(
            event.operation_id == outcome.operation_id and event.call_id == "call-1"
            for event in recorded
        )
        assert [event.result.content[0].text for event in recorded[1:]] == ["one", "two", "final"]
        saved_update[0](AgentToolResult(content=[TextContent(text="late")]))
        assert len(recorded) == 4
        assert [m.role for m in harness.get_snapshot().messages] == [
            "user",
            "assistant",
            "toolResult",
            "assistant",
        ]
        assert [m.role for m in adapter.requests[1].messages[-3:]] == [
            "user",
            "assistant",
            "toolResult",
        ]
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_listener_mutation_and_failure_do_not_change_result_or_other_listeners(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = OneToolAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    observed: list[object] = []
    errors: list[object] = []

    async def execute(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text="final")])

    harness = AgentHarness(models, provider.models[0], tools=[lookup_tool(execute)])

    async def mutate(event: object) -> None:
        event.result.content[0].text = "changed"

    async def fail(_event: object) -> None:
        raise RuntimeError("listener broke")

    harness.events.on("tool_end", mutate)
    harness.events.on("tool_end", fail)
    unsubscribe = harness.events.on("tool_end", observed.append)
    harness.events.on("handler_error", errors.append)
    harness.events.on("handler_error", fail)
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        assert observed[0].result.content[0].text == "final"
        assert harness.get_snapshot().messages[2].content[0].text == "final"
        assert len(errors) == 1
        assert errors[0].source == "event" and errors[0].event_type == "tool_end"
        unsubscribe()
        assert (await harness.prompt("again")).status == "completed"
        assert len(observed) == 1
    finally:
        await models.aclose()
