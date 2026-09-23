"""Verify one short real DeepSeek tool-call conversation."""

import asyncio

import pytest

from app.agent import AgentHarness, AgentTool, AgentToolResult, OperationResult
from app.ai import JSONValue, Models, Provider, TextContent, ToolDefinition
from app.ai.messages import ToolResultMessage
from app.ai.model import Model

pytestmark = [pytest.mark.asyncio, pytest.mark.live]


async def test_real_tool_call_and_short_reply(
    live_provider_and_model: tuple[Provider, Model],
) -> None:
    provider, model = live_provider_and_model
    models = Models([provider])
    calls: list[tuple[str, dict[str, JSONValue]]] = []

    async def read_token(
        call_id: str, arguments: dict[str, JSONValue], *_rest: object
    ) -> AgentToolResult:
        calls.append((call_id, arguments))
        return AgentToolResult(content=[TextContent(text="The token is blue-orbit-7.")])

    tool = AgentTool(
        definition=ToolDefinition(
            name="read_token",
            description="Read the short token required to answer the user's question.",
            parameters={
                "type": "object",
                "properties": {"key": {"type": "string"}},
                "required": ["key"],
            },
        ),
        execute=read_token,
    )
    harness = AgentHarness(
        models,
        model,
        system_prompt="Call read_token before answering. Keep your final answer short.",
        tools=[tool],
    )
    running = asyncio.create_task(
        harness.prompt(
            "Use read_token with key 'sample', then tell me the token in one short sentence."
        )
    )
    try:
        outcome = await asyncio.wait_for(asyncio.shield(running), 60)
        assert isinstance(outcome, OperationResult)
        assert outcome.status == "completed", outcome.error_message
        assert len(calls) == 1
        assert calls[0][1] == {"key": "sample"}
        snapshot = harness.get_snapshot()
        results = [m for m in snapshot.messages if isinstance(m, ToolResultMessage)]
        assert len(results) == 1
        assert results[0].tool_call_id == calls[0][0]
        assert not results[0].is_error
        assert outcome.assistant_message is not None
        assert any(
            isinstance(block, TextContent) and block.text.strip()
            for block in outcome.assistant_message.content
        )
    finally:
        try:
            await models.aclose()
        finally:
            await asyncio.gather(running, return_exceptions=True)
