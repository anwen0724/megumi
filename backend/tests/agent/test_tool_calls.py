"""Verify model/tool/model conversations through the public Agent Harness."""

from __future__ import annotations

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult, ToolInvocation
from app.ai import CallOptions, JSONValue, Models, Provider, TextContent, ToolCall, ToolDefinition
from app.ai.messages import ToolResultMessage


class ToolThenAnswerAdapter:
    """Return fixed external responses without implementing the Agent loop."""

    options_type = CallOptions

    def __init__(self) -> None:
        self.requests: list[object] = []

    async def stream_simple(self, **call: object) -> None:
        writer = call["writer"]
        transcript = call["transcript"]
        self.requests.append(transcript)
        writer.emit({"type": "start", "partial": writer.partial})
        if len(self.requests) == 1:
            writer.partial.content.append(
                ToolCall(id="call-read-1", name="read_article", arguments={"id": "article-1"})
            )
            writer.emit({"type": "done", "reason": "tool_use", "message": writer.partial})
        else:
            writer.partial.content.append(TextContent(text="The article says hello."))
            writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def stream(self, **call: object) -> None:
        await self.stream_simple(**call)


@pytest.mark.asyncio
async def test_tool_result_is_returned_to_model_within_one_operation(
    provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SAMPLE_API_KEY", "synthetic-key")
    adapter = ToolThenAnswerAdapter()
    models = Models([provider], adapters={provider.api: adapter})
    executions: list[tuple[str, dict[str, JSONValue], str]] = []

    async def read_article(
        call_id: str,
        arguments: dict[str, JSONValue],
        _on_update: object,
        _context: object | None,
        invocation: ToolInvocation,
    ) -> AgentToolResult:
        executions.append((call_id, arguments, invocation.operation_id))
        return AgentToolResult(content=[TextContent(text="Article: hello")])

    tool = AgentTool(
        definition=ToolDefinition(
            name="read_article",
            description="Read one short article",
            parameters={
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        ),
        execute=read_article,
    )
    harness = AgentHarness(models, provider.models[0], tools=[tool])
    try:
        outcome = await harness.prompt("Read article-1 and summarize it")
        assert outcome.status == "completed"
        assert outcome.assistant_message.content == [TextContent(text="The article says hello.")]
        history = harness.get_snapshot()
        assert len(history.operations) == 1
        assert [message.role for message in history.messages] == [
            "user",
            "assistant",
            "toolResult",
            "assistant",
        ]
        result = history.messages[2]
        assert isinstance(result, ToolResultMessage)
        assert result.tool_call_id == "call-read-1"
        assert result.content == [TextContent(text="Article: hello")]
        assert executions == [("call-read-1", {"id": "article-1"}, outcome.operation_id)]
        assert len(adapter.requests) == 2
        assert [message.role for message in adapter.requests[1].messages[-3:]] == [
            "user",
            "assistant",
            "toolResult",
        ]
    finally:
        await models.aclose()
