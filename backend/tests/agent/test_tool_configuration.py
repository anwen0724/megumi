"""Verify enabled tool declarations and configuration through public requests."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult
from app.ai import CallOptions, Models, Provider, TextContent, ToolDefinition, get_current_tools


class AnswerAdapter:
    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        self.requests.append(call["transcript"])
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="done"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


def make_tool(name: str) -> AgentTool:
    async def execute(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text=name)])

    return AgentTool(
        definition=ToolDefinition(name=name, description=name, parameters={"type": "object"}),
        execute=execute,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("active", "expected"),
    [(None, ["first", "second"]), ([], []), (["second"], ["second"])],
)
async def test_declared_tools_match_enabled_names(
    provider: Provider,
    monkeypatch: pytest.MonkeyPatch,
    active: list[str] | None,
    expected: list[str],
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = AnswerAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    harness = AgentHarness(
        models,
        provider.models[0],
        tools=[make_tool("first"), make_tool("second")],
        active_tool_names=active,
    )
    try:
        assert (await harness.prompt("hello")).status == "completed"
        assert [tool.name for tool in get_current_tools(adapter.requests[0].messages)] == expected
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_duplicate_name_rejected_and_missing_enabled_name_fails_before_request(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = AnswerAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    try:
        with pytest.raises(ValueError, match="duplicate"):
            AgentHarness(models, provider.models[0], tools=[make_tool("first"), make_tool("first")])
        harness = AgentHarness(
            models, provider.models[0], tools=[make_tool("first")], active_tool_names=["missing"]
        )
        outcome = await harness.prompt("hello")
        assert outcome.status == "failed"
        assert "missing" in outcome.error_message
        assert adapter.requests == []
    finally:
        await models.aclose()
