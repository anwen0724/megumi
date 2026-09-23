"""Verify serial/parallel scheduling and ordered batch placement."""

from __future__ import annotations

import asyncio

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult
from app.agent.hooks import AfterToolPatch
from app.ai import CallOptions, Models, Provider, TextContent, ToolCall, ToolDefinition
from app.ai.messages import ToolResultMessage


class TwoCallAdapter:
    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        self.requests.append(call["transcript"])
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        if len(self.requests) == 1:
            writer.partial.content.extend(
                [
                    ToolCall(id="first-id", name="first", arguments={}),
                    ToolCall(id="second-id", name="second", arguments={}),
                ]
            )
            reason = "tool_use"
        else:
            writer.partial.content.append(TextContent(text="done"))
            reason = "stop"
        writer.emit({"type": "done", "reason": reason, "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


def tool(name: str, execute: object) -> AgentTool:
    return AgentTool(
        definition=ToolDefinition(
            name=name,
            description=name,
            parameters={"type": "object"},
        ),
        execute=execute,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sequential", "parallel"])
async def test_batch_execution_mode_and_source_order_placement(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TwoCallAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    first_started = asyncio.Event()
    second_started = asyncio.Event()
    release_first = asyncio.Event()
    completed: list[str] = []

    async def first(*_args: object) -> AgentToolResult:
        first_started.set()
        await release_first.wait()
        completed.append("first-id")
        return AgentToolResult(content=[TextContent(text="first result")])

    async def second(*_args: object) -> AgentToolResult:
        second_started.set()
        completed.append("second-id")
        return AgentToolResult(content=[TextContent(text="second result")])

    harness = AgentHarness(
        models,
        provider.models[0],
        tools=[tool("first", first), tool("second", second)],
        tool_execution=mode,
    )
    task = asyncio.create_task(harness.prompt("compare"))
    try:
        await asyncio.wait_for(first_started.wait(), 5)
        if mode == "parallel":
            await asyncio.wait_for(second_started.wait(), 5)
            assert completed == ["second-id"]
            assert len(adapter.requests) == 1
            assert [m.role for m in harness.get_snapshot().messages] == ["user", "assistant"]
        else:
            assert not second_started.is_set()
        release_first.set()
        assert (await asyncio.wait_for(task, 5)).status == "completed"
        assert second_started.is_set()
        results = [m for m in harness.get_snapshot().messages if isinstance(m, ToolResultMessage)]
        assert [m.tool_call_id for m in results] == ["first-id", "second-id"]
        assert [
            m.tool_call_id for m in adapter.requests[1].messages if isinstance(m, ToolResultMessage)
        ] == ["first-id", "second-id"]
        assert completed == (
            ["first-id", "second-id"] if mode == "sequential" else ["second-id", "first-id"]
        )
    finally:
        release_first.set()
        await task
        await models.aclose()


@pytest.mark.asyncio
async def test_one_parallel_tool_failure_does_not_cancel_sibling(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TwoCallAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    sibling_started = asyncio.Event()
    sibling_completed = asyncio.Event()

    async def failed(*_args: object) -> AgentToolResult:
        await sibling_started.wait()
        raise RuntimeError("first failed")

    async def sibling(*_args: object) -> AgentToolResult:
        sibling_started.set()
        sibling_completed.set()
        return AgentToolResult(content=[TextContent(text="second survived")])

    harness = AgentHarness(
        models, provider.models[0], tools=[tool("first", failed), tool("second", sibling)]
    )
    try:
        assert (await asyncio.wait_for(harness.prompt("compare"), 5)).status == "completed"
        assert sibling_completed.is_set()
        results = [m for m in harness.get_snapshot().messages if isinstance(m, ToolResultMessage)]
        assert [(m.tool_call_id, m.is_error) for m in results] == [
            ("first-id", True),
            ("second-id", False),
        ]
    finally:
        await models.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("all_terminate", [False, True])
async def test_only_whole_batch_termination_skips_final_model_turn(
    provider: Provider, monkeypatch: pytest.MonkeyPatch, all_terminate: bool
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TwoCallAdapter()
    models = Models([provider], adapters={provider.api: adapter})

    async def first(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text="one")], terminate=True)

    async def second(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text="two")], terminate=all_terminate)

    harness = AgentHarness(
        models, provider.models[0], tools=[tool("first", first), tool("second", second)]
    )
    try:
        outcome = await harness.prompt("compare")
        assert outcome.status == "completed"
        assert len(adapter.requests) == (1 if all_terminate else 2)
        assert (outcome.assistant_message is None) == all_terminate
        assert [m.role for m in harness.get_snapshot().messages] == (
            ["user", "assistant", "toolResult", "toolResult"]
            if all_terminate
            else ["user", "assistant", "toolResult", "toolResult", "assistant"]
        )
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_completed_prefix_is_saved_while_later_parallel_tool_is_pending(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TwoCallAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    second_started = asyncio.Event()
    release_second = asyncio.Event()

    async def first(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text="first")])

    async def second(*_args: object) -> AgentToolResult:
        second_started.set()
        await release_second.wait()
        return AgentToolResult(content=[TextContent(text="second")])

    harness = AgentHarness(
        models, provider.models[0], tools=[tool("first", first), tool("second", second)]
    )
    running = asyncio.create_task(harness.prompt("compare"))
    try:
        await asyncio.wait_for(second_started.wait(), 5)

        async def wait_for_prefix() -> None:
            while len(harness.get_snapshot().messages) < 3:
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_prefix(), 5)
        assert [m.role for m in harness.get_snapshot().messages] == [
            "user",
            "assistant",
            "toolResult",
        ]
        assert len(adapter.requests) == 1
        release_second.set()
        assert (await asyncio.wait_for(running, 5)).status == "completed"
    finally:
        release_second.set()
        await asyncio.gather(running, return_exceptions=True)
        await models.aclose()


@pytest.mark.asyncio
async def test_after_hook_final_terminate_flag_controls_whole_batch(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = TwoCallAdapter()
    models = Models([provider], adapters={provider.api: adapter})

    async def execute(*_args: object) -> AgentToolResult:
        return AgentToolResult(content=[TextContent(text="done")])

    harness = AgentHarness(
        models,
        provider.models[0],
        tools=[
            tool("first", execute),
            tool("second", execute),
        ],
    )

    async def terminate(_context: object) -> AfterToolPatch:
        return AfterToolPatch(terminate=True)

    harness.hooks.on("after_tool", terminate)
    try:
        outcome = await harness.prompt("compare")
        assert outcome.status == "completed" and outcome.assistant_message is None
        assert len(adapter.requests) == 1
        assert [m.role for m in harness.get_snapshot().messages] == [
            "user",
            "assistant",
            "toolResult",
            "toolResult",
        ]
    finally:
        await models.aclose()
