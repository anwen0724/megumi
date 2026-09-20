"""Message JSON preserves the caller-visible conversation."""

import json

import pytest

from app.ai.codec import decode_messages, encode_messages
from app.ai.errors import MessageDecodeError
from app.ai.messages import AssistantMessage, TextContent, UserMessage


def test_text_conversation_round_trip():
    messages = [
        UserMessage(content="Hello", timestamp=1),
        AssistantMessage(
            content=[TextContent(text="Hi")],
            provider="sample",
            api="openai-completions",
            model="small",
            timestamp=2,
            stop_reason="stop",
        ),
    ]
    encoded = encode_messages(messages)
    assert isinstance(json.loads(encoded), list)
    restored = decode_messages(encoded)
    assert restored == messages
    restored[1].content[0].text = "changed"
    assert messages[1].content[0].text == "Hi"


def test_tool_and_system_history_preserves_signatures_and_unvalidated_values():
    from app.ai.messages import (
        ImageContent,
        JsonSchemaSampling,
        SystemMessage,
        ThinkingContent,
        ToolCall,
        ToolDefinition,
        ToolResultMessage,
    )

    tool = ToolDefinition(
        name="weather",
        description="Weather",
        parameters={"type": "object"},
        constrained_sampling=JsonSchemaSampling(strict="prefer"),
    )
    messages = [
        SystemMessage(
            content="Be concise",
            timestamp=0,
            sections={"style": "brief"},
            tools_added=[tool],
            tools_removed=["old"],
            replace=True,
        ),
        UserMessage(
            content=[TextContent(text="Look"), ImageContent(mime_type="image/png", data="AA==")],
            timestamp=1,
        ),
        AssistantMessage(
            provider="sample",
            api="openai-completions",
            model="small",
            timestamp=2,
            content=[
                ThinkingContent(thinking="", thinking_signature="encrypted", redacted=True),
                TextContent(text="Checking", text_signature="item-id"),
                ToolCall(
                    id="c1",
                    name="weather",
                    arguments=[],
                    thought_signature="sig",
                    namespace="functions",
                ),
            ],
            stop_reason="length",
            response_id="r1",
            response_model="resolved",
            raw_stop_reason="limit",
            diagnostics={"request_id": "fake"},
            end_turn=False,
            provider_thinking_level="high",
        ),
        ToolResultMessage(
            tool_call_id="c1",
            tool_name="weather",
            content=[TextContent(text="bad")],
            is_error=True,
            timestamp=3,
            details={"value": None},
        ),
    ]
    assert decode_messages(encode_messages(messages)) == messages
    for value in (None, 123, False, "unfinished", [], {"q": "partial"}):
        messages[2].content[2].arguments = value
        assert decode_messages(encode_messages(messages))[2].content[2].arguments == value


@pytest.mark.parametrize(
    "record",
    [
        {"role": "unknown", "timestamp": 1, "content": ""},
        {"role": "user", "timestamp": "1", "content": ""},
        {"role": "user", "timestamp": True, "content": ""},
        {"role": "user", "timestamp": 1, "content": "", "api_key": "fake"},
        {"role": "assistant", "timestamp": 1, "content": [{"type": "toolCall", "id": "c"}]},
        {"role": "user", "timestamp": 1, "content": [{"type": "image", "data": "AA=="}]},
    ],
)
def test_decode_rejects_invalid_message_structure(record):
    with pytest.raises(MessageDecodeError):
        decode_messages(json.dumps([record]))


def test_encoder_does_not_serialize_arbitrary_objects_or_coerce_argument_numbers():
    from app.ai.messages import ToolCall

    message = AssistantMessage(
        content=[ToolCall(id="c", name="t", arguments={"n": 1})],
        provider="p",
        api="a",
        model="m",
        timestamp=1,
    )
    message.diagnostics = object()
    with pytest.raises((TypeError, MessageDecodeError)):
        encode_messages([message])


def test_decimal_is_only_serialized_in_cost_fields_not_tool_arguments():
    from decimal import Decimal

    from app.ai.messages import ToolCall

    msg = AssistantMessage(
        content=[ToolCall(id="c", name="t", arguments={"n": Decimal("1.2")})],
        provider="p",
        api="a",
        model="m",
        timestamp=1,
    )
    with pytest.raises((TypeError, MessageDecodeError)):
        encode_messages([msg])
