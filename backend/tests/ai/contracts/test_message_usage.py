"""Reported model usage and independent tool usage survive message persistence."""

import json
from decimal import Decimal

from app.ai.codec import decode_messages, encode_messages


def test_cost_precision_and_unknown_usage_are_not_overwritten_by_tool_usage():
    from app.ai.messages import AssistantMessage, ToolResultMessage, Usage, UsageCost

    model_usage = Usage(
        input=0,
        output=100,
        reasoning=30,
        total_tokens=None,
        cost=UsageCost(currency="CNY", input=Decimal("0"), output=Decimal("0.000123456789")),
    )
    messages = [
        AssistantMessage(
            content=[], provider="p", api="a", model="m", timestamp=1, usage=model_usage
        ),
        ToolResultMessage(
            tool_call_id="c",
            tool_name="t",
            content=[],
            is_error=False,
            timestamp=2,
            usage=Usage(input=999, total_tokens=999),
        ),
    ]
    encoded = encode_messages(messages)
    wire = json.loads(encoded)
    assert wire[0]["usage"]["cost"]["output"] == "0.000123456789"
    assert wire[0]["usage"]["cost"]["total"] is None
    assert wire[0]["usage"]["cache_read"] is None
    assert wire[0]["usage"]["input"] == 0
    assert decode_messages(encoded) == messages
    assert model_usage.output == 100
    assert model_usage.total_tokens is None
