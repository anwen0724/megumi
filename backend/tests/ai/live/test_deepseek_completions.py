"""Opt-in real DeepSeek contract checks; skipped tests are not provider acceptance."""

import pytest

from app.ai import (
    CompletionsOptions,
    Context,
    SimpleOptions,
    TextContent,
    ThinkingContent,
    Tool,
    ToolCall,
    ToolResultMessage,
    UserMessage,
    decode_messages,
    encode_messages,
    validate_tool_call,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.live]


async def test_live_text(live_models, live_model, record_final):
    _, model = live_model
    final = await live_models.complete_simple(
        model,
        Context(messages=[UserMessage(content="Say hello in one short sentence.", timestamp=0)]),
        SimpleOptions(reasoning="off", max_output_tokens=256, timeout_ms=60000),
    )
    record_final(final)
    assert final.stop_reason == "stop", final.error_message
    assert any(isinstance(block, TextContent) and block.text.strip() for block in final.content)


async def test_live_reasoning(live_models, live_model, record_final):
    _, model = live_model
    final = await live_models.complete_simple(
        model,
        Context(
            messages=[UserMessage(content="Work out 17 times 23 and explain briefly.", timestamp=0)]
        ),
        SimpleOptions(reasoning="high", max_output_tokens=4096, timeout_ms=60000),
    )
    record_final(final)
    assert final.stop_reason == "stop", final.error_message
    assert any(
        isinstance(block, ThinkingContent) and block.thinking.strip() for block in final.content
    )
    assert any(isinstance(block, TextContent) and block.text.strip() for block in final.content)


async def test_live_tool_roundtrip(live_models, live_model, record_final):
    _, model = live_model
    tool = Tool(
        name="lookup",
        description="Return the test record by key.",
        parameters={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
    )
    user = UserMessage(
        content="Use lookup for key sample, then report the returned value verbatim.", timestamp=0
    )
    first = await live_models.complete(
        model,
        Context(messages=[user], tools=[tool]),
        CompletionsOptions(
            reasoning_effort="low",
            tool_choice={"type": "function", "function": {"name": "lookup"}},
            max_output_tokens=4096,
            timeout_ms=60000,
        ),
    )
    record_final(first)
    assert first.stop_reason == "tool_use", first.error_message
    calls = [block for block in first.content if isinstance(block, ToolCall)]
    assert calls
    history = decode_messages(encode_messages([user, first]))
    for call in calls:
        validate_tool_call([tool], call)
        history.append(
            ToolResultMessage(
                tool_call_id=call.id,
                tool_name=call.name,
                content=[TextContent(text="MEGUMI_TOOL_OK_7")],
                is_error=False,
                timestamp=1,
            )
        )
    second = await live_models.complete(
        model,
        Context(messages=history, tools=[tool]),
        CompletionsOptions(
            reasoning_effort="low", tool_choice="none", max_output_tokens=4096, timeout_ms=60000
        ),
    )
    record_final(second)
    assert second.stop_reason == "stop", second.error_message
    assert "MEGUMI_TOOL_OK_7" in "".join(
        block.text for block in second.content if isinstance(block, TextContent)
    )


async def test_live_cancellation(live_models, live_model, record_final):
    _, model = live_model
    response = live_models.stream_simple(
        model,
        Context(
            messages=[
                UserMessage(content="Write the integers from 1 to 2000, one per line.", timestamp=0)
            ]
        ),
        SimpleOptions(reasoning="off", max_output_tokens=8192, timeout_ms=60000),
    )
    received = False
    async for event in response:
        if event["type"] in ("text_delta", "thinking_delta"):
            received = True
            response.cancel()
            break
    final = await response.result()
    record_final(final)
    await response.aclose()
    assert received
    assert final.stop_reason == "aborted", final.error_message
    assert final.content
