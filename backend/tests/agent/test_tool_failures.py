"""Exercise tool errors through actual Agent and AI request boundaries."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult
from app.ai import CallOptions, JSONValue, Models, Provider, TextContent, ToolCall, ToolDefinition
from app.ai.messages import ToolResultMessage


class ScriptedAdapter:
    options_type = CallOptions

    def __init__(self, turns: list[tuple[str, list[ToolCall] | str]]) -> None:
        self.turns = turns
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        self.requests.append(call["transcript"])
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        reason, content = self.turns[len(self.requests) - 1]
        writer.partial.content.extend(
            [TextContent(text=content)] if isinstance(content, str) else content
        )
        writer.emit({"type": "done", "reason": reason, "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


def tool_call(call_id: str, name: str = "lookup", value: JSONValue = "1") -> ToolCall:
    return ToolCall(id=call_id, name=name, arguments={"id": value})


def make_tool(execute: object, prepare: object | None = None) -> AgentTool:
    return AgentTool(
        definition=ToolDefinition(
            name="lookup",
            description="Lookup",
            parameters={
                "type": "object",
                "properties": {"id": {"type": "integer"}},
                "required": ["id"],
            },
        ),
        execute=execute,
        prepare_arguments=prepare,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("unavailable", ["unknown", "disabled"])
async def test_unknown_or_disabled_tool_becomes_model_visible_error(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, unavailable: str
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter(
        [
            ("tool_use", [tool_call("bad", "missing" if unavailable == "unknown" else "lookup")]),
            ("stop", "done"),
        ]
    )
    models = Models([provider], adapters={provider.api: adapter})
    calls: list[object] = []

    async def execute(*args: object) -> AgentToolResult:
        calls.append(args)
        return AgentToolResult(content=[TextContent(text="not expected")])

    harness = AgentHarness(
        models,
        provider.models[0],
        tools=[make_tool(execute)],
        active_tool_names=[] if unavailable == "disabled" else None,
    )
    try:
        outcome = await harness.prompt("lookup")
        assert outcome.status == "completed"
        assert calls == []
        result = harness.get_snapshot().messages[2]
        assert isinstance(result, ToolResultMessage)
        assert result.tool_call_id == "bad" and result.is_error
        assert "tool" in result.content[0].text.lower()
        assert adapter.requests[1].messages[-1] == result
    finally:
        await models.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["prepare", "invalid", "execute"])
async def test_preparation_validation_and_execution_failures_return_results(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter([("tool_use", [tool_call("first")]), ("stop", "done")])
    models = Models([provider], adapters={provider.api: adapter})
    calls: list[dict[str, JSONValue]] = []

    async def execute(_id: str, args: dict[str, JSONValue], *_rest: object) -> AgentToolResult:
        calls.append(args)
        if failure == "execute":
            raise RuntimeError("lookup unavailable")
        return AgentToolResult(content=[TextContent(text="found")])

    def prepare(_args: JSONValue) -> JSONValue:
        if failure == "prepare":
            raise ValueError("bad preparation")
        if failure == "invalid":
            return {"id": "not-an-integer"}
        return {"id": "2"}

    harness = AgentHarness(models, provider.models[0], tools=[make_tool(execute, prepare)])
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        result = harness.get_snapshot().messages[2]
        assert isinstance(result, ToolResultMessage) and result.is_error
        assert calls == ([{"id": 2}] if failure == "execute" else [])
        assert adapter.requests[1].messages[-1] == result
        assert harness.get_snapshot().messages[1].content[0].arguments == {"id": "1"}
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_length_tool_call_is_not_executed_and_model_can_retry(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter(
        [
            ("length", [tool_call("truncated")]),
            ("tool_use", [tool_call("complete", value="2")]),
            ("stop", "done"),
        ]
    )
    models = Models([provider], adapters={provider.api: adapter})
    calls: list[str] = []

    async def execute(call_id: str, *_args: object) -> AgentToolResult:
        calls.append(call_id)
        return AgentToolResult(content=[TextContent(text="found")])

    harness = AgentHarness(models, provider.models[0], tools=[make_tool(execute)])
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        results = [m for m in harness.get_snapshot().messages if isinstance(m, ToolResultMessage)]
        assert [(m.tool_call_id, m.is_error) for m in results] == [
            ("truncated", True),
            ("complete", False),
        ]
        assert "incomplete" in results[0].content[0].text.lower()
        assert calls == ["complete"]
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_model_can_issue_new_call_after_execution_error(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter(
        [
            ("tool_use", [tool_call("failed", value="1")]),
            ("tool_use", [tool_call("corrected", value="2")]),
            ("stop", "done"),
        ]
    )
    models = Models([provider], adapters={provider.api: adapter})
    calls: list[tuple[str, dict[str, JSONValue]]] = []

    async def execute(
        call_id: str, arguments: dict[str, JSONValue], *_rest: object
    ) -> AgentToolResult:
        calls.append((call_id, arguments))
        if call_id == "failed":
            raise RuntimeError("item unavailable")
        return AgentToolResult(content=[TextContent(text="found")])

    harness = AgentHarness(models, provider.models[0], tools=[make_tool(execute)])
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        results = [m for m in harness.get_snapshot().messages if isinstance(m, ToolResultMessage)]
        assert [(m.tool_call_id, m.is_error) for m in results] == [
            ("failed", True),
            ("corrected", False),
        ]
        assert calls == [("failed", {"id": 1}), ("corrected", {"id": 2})]
        assert adapter.requests[1].messages[-1] == results[0]
        assert adapter.requests[2].messages[-1] == results[1]
    finally:
        await models.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("has_failure_message", [False, True])
async def test_model_failure_after_tool_keeps_result_without_reexecution(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, has_failure_message: bool
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter(
        [
            ("tool_use", [tool_call("first")]),
            ("error", "supplier failed"),
        ]
    )
    models = Models([provider], adapters={provider.api: adapter})
    executions: list[str] = []

    async def execute(call_id: str, *_args: object) -> AgentToolResult:
        executions.append(call_id)
        if not has_failure_message:
            await models.aclose()
        return AgentToolResult(content=[TextContent(text="stored result")])

    harness = AgentHarness(models, provider.models[0], tools=[make_tool(execute)])
    try:
        outcome = await harness.prompt("lookup")
        assert outcome.status == "failed"
        assert executions == ["first"]
        history = harness.get_snapshot()
        assert isinstance(history.messages[2], ToolResultMessage)
        assert history.messages[2].content == [TextContent(text="stored result")]
        assert (outcome.assistant_message is not None) == has_failure_message
        assert len(adapter.requests) == (2 if has_failure_message else 1)
    finally:
        if has_failure_message:
            await models.aclose()


@pytest.mark.asyncio
async def test_tool_use_without_call_fails_without_another_request(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ScriptedAdapter([("tool_use", [])])
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(models, provider.models[0])
    try:
        outcome = await harness.prompt("lookup")
        assert outcome.status == "failed"
        assert len(adapter.requests) == 1
        assert [m.role for m in harness.get_snapshot().messages] == ["user", "assistant"]
    finally:
        await models.aclose()
