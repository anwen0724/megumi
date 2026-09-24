"""Verify before/after hooks through a model-tool-model operation."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.agent import AfterToolPatch, AgentHarness, AgentTool, AgentToolResult, BeforeToolDecision
from app.ai import CallOptions, JSONValue, Models, Provider, TextContent, ToolCall
from app.ai.api.openai_runtime import OpenAIProtocol


class HookAdapter(OpenAIProtocol):
    options_type = CallOptions

    def __init__(self) -> None:
        self.calls = 0

    async def _produce_simple(self, **call: object) -> None:
        self.calls += 1
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        if self.calls == 1:
            writer.partial.content.append(ToolCall(id="c1", name="lookup", arguments={"id": "1"}))
            reason = "tool_use"
        else:
            writer.partial.content.append(TextContent(text="done"))
            reason = "stop"
        writer.emit({"type": "done", "reason": reason, "message": writer.partial})

    async def _produce(self, **call: object) -> None:
        await self._produce_simple(**call)


def make_tool(execute: object) -> AgentTool:
    return AgentTool(
        name="lookup",
        description="Lookup",
        parameters={
            "type": "object",
            "properties": {"id": {"type": "integer"}},
            "required": ["id"],
        },
        execute=execute,
    )


@pytest.mark.asyncio
async def test_before_hooks_pass_replacements_and_validate_final_arguments(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    models = Models([replace(provider, api=HookAdapter())])
    calls: list[dict[str, JSONValue]] = []
    seen: list[dict[str, JSONValue]] = []

    async def execute(_id: str, args: dict[str, JSONValue], *_rest: object) -> AgentToolResult:
        calls.append(args)
        return AgentToolResult(content=[TextContent(text="found")])

    harness = AgentHarness(models, provider.get_models()[0], tools=[make_tool(execute)])

    async def change(_context: object) -> BeforeToolDecision:
        return BeforeToolDecision(arguments={"id": "2"})

    async def see(context: object) -> None:
        seen.append(context.arguments)

    harness.hooks.on("before_tool", change)
    harness.hooks.on("before_tool", see)
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        assert seen == [{"id": "2"}]
        assert calls == [{"id": 2}]
        assert harness.get_snapshot().messages[1].content[0].arguments == {"id": "1"}
    finally:
        await models.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["block", "throw", "invalid"])
async def test_before_hook_block_error_or_invalid_replacement_prevents_execution(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    models = Models([replace(provider, api=HookAdapter())])
    calls: list[object] = []
    later: list[object] = []
    errors: list[object] = []
    after_calls: list[object] = []

    async def execute(*args: object) -> AgentToolResult:
        calls.append(args)
        return AgentToolResult(content=[TextContent(text="found")])

    harness = AgentHarness(models, provider.get_models()[0], tools=[make_tool(execute)])

    async def before(_context: object) -> BeforeToolDecision:
        if mode == "throw":
            raise RuntimeError("hook crashed")
        if mode == "invalid":
            return BeforeToolDecision(arguments={"id": "bad"})
        return BeforeToolDecision(block_reason="blocked by host", terminate=True)

    harness.hooks.on("before_tool", before)
    harness.hooks.on("before_tool", later.append)
    harness.hooks.on("after_tool", after_calls.append)
    harness.events.on("handler_error", errors.append)
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        assert calls == []
        assert after_calls == []
        result = harness.get_snapshot().messages[2]
        assert result.is_error
        assert len(errors) == (1 if mode == "throw" else 0)
        assert [context.arguments for context in later] == (
            [{"id": "bad"}] if mode == "invalid" else []
        )
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_after_hooks_keep_successful_patches_when_later_handler_throws(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    models = Models([replace(provider, api=HookAdapter())])
    observed: list[str] = []
    errors: list[object] = []

    async def execute(*_args: object) -> AgentToolResult:
        raise RuntimeError("tool failed")

    harness = AgentHarness(models, provider.get_models()[0], tools=[make_tool(execute)])

    async def patch(_context: object) -> AfterToolPatch:
        return AfterToolPatch(content=[TextContent(text="recovered")], is_error=False)

    async def fail(_context: object) -> None:
        raise RuntimeError("post hook broke")

    async def observe(context: object) -> AfterToolPatch:
        observed.append(context.result.content[0].text)
        return AfterToolPatch(details={"source": "hook"})

    harness.hooks.on("after_tool", patch)
    harness.hooks.on("after_tool", fail)
    harness.hooks.on("after_tool", observe)
    harness.events.on("handler_error", errors.append)
    try:
        assert (await harness.prompt("lookup")).status == "completed"
        result = harness.get_snapshot().messages[2]
        assert observed == ["recovered"]
        assert result.content == [TextContent(text="recovered")]
        assert result.is_error is False and result.details == {"source": "hook"}
        assert len(errors) == 1 and errors[0].source == "hook"
    finally:
        await models.aclose()
