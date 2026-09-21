"""Opt-in real OpenAI Responses contract checks; skipped tests are not provider acceptance."""

import base64
import struct
import zlib

import pytest

from app.ai import (
    Context,
    ImageContent,
    ResponsesOptions,
    SimpleOptions,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
    UserMessage,
    decode_messages,
    encode_messages,
    validate_tool_call,
)

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.live,
    pytest.mark.parametrize("live_model", ["openai"], indirect=True),
]


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
    if not model.capabilities.reasoning:
        pytest.skip("Selected model has no reasoning capability; reasoning remains unverified")
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
        isinstance(block, ThinkingContent) and block.thinking_signature for block in final.content
    )
    assert any(isinstance(block, TextContent) and block.text.strip() for block in final.content)


async def test_live_tool_roundtrip(live_models, live_model, record_final):
    _, model = live_model
    tool = ToolDefinition(
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
        ResponsesOptions(
            reasoning_effort="low",
            tool_choice={"type": "function", "name": "lookup"},
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
        ResponsesOptions(
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


async def test_live_vision(live_models, live_model, record_final):
    _, model = live_model
    if "image" not in model.capabilities.input_modalities:
        pytest.skip("Selected model has no image input; vision remains unverified")
    final = await live_models.complete_simple(
        model,
        Context(
            messages=[
                UserMessage(
                    content=[
                        TextContent(
                            text=(
                                "What is the dominant color of this image? "
                                "Reply with one English color word."
                            )
                        ),
                        ImageContent(mime_type="image/png", data=red_png()),
                    ],
                    timestamp=0,
                )
            ]
        ),
        SimpleOptions(reasoning="off", max_output_tokens=256, timeout_ms=60000),
    )
    record_final(final)
    assert final.stop_reason == "stop", final.error_message
    assert "red" in "".join(b.text for b in final.content if isinstance(b, TextContent)).lower()


def red_png():
    """Create a controlled solid-red 32x32 RGB sample entirely in memory."""

    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    header = struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0)
    pixels = (b"\x00" + b"\xff\x00\x00" * 32) * 32
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode("ascii")
