"""Tests for the AI layer's type contract.

These cases are structural: they pin the discriminants, defaults and field names that the
wire format and the stream protocol depend on, so a rename or a reordered field is caught
here rather than inside an adapter.
"""

from __future__ import annotations

from dataclasses import asdict, fields
from typing import get_args

import pytest

from app.ai import types


def test_every_public_name_is_importable() -> None:
    missing = [name for name in types.__all__ if not hasattr(types, name)]

    # The stream container is defined beside the types it carries, so it is named here
    # for readers but imported from its own module.
    assert missing == ["AssistantMessageEventStream"]


def test_all_is_sorted_and_unique() -> None:
    names = list(types.__all__)

    assert names == sorted(names)
    assert len(names) == len(set(names))


@pytest.mark.parametrize(
    ("enum", "expected"),
    [
        (types.ToolChoice, ["auto", "none"]),
        (types.ThinkingLevel, ["minimal", "low", "medium", "high", "xhigh", "max"]),
        (types.ModelThinkingLevel, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
        (types.CacheRetention, ["none", "short", "long"]),
        (types.Transport, ["sse", "websocket", "websocket-cached", "auto"]),
        (
            types.SessionAffinityFormat,
            ["openai", "openai-nosession", "openrouter"],
        ),
        (
            types.StopReason,
            ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"],
        ),
        (
            types.ThinkingTokenBudgetField,
            ["thinking_token_budget", "thinking_budget", "thinking_budget_tokens"],
        ),
        (types.GrammarFormat, ["openai_lark", "openai_regex"]),
    ],
)
def test_closed_string_sets_keep_their_wire_values(
    enum: type[types.StopReason],
    expected: list[str],
) -> None:
    assert [member.value for member in enum] == expected


def test_stop_reason_serializes_as_a_plain_string() -> None:
    assert types.StopReason.TOOL_USE == "toolUse"
    assert f"{types.StopReason.ERROR}" == "error"


def test_assistant_message_keeps_the_wire_field_names() -> None:
    names = {field.name for field in fields(types.AssistantMessage)}

    assert {
        "content",
        "api",
        "provider",
        "model",
        "usage",
        "stopReason",
        "responseModel",
        "responseId",
        "providerThinkingLevel",
        "diagnostics",
        "deferred",
        "errorMessage",
        "rawStopReason",
        "endTurn",
        "timestamp",
        "role",
    } <= names


def test_message_roles_carry_their_wire_values() -> None:
    assert types.SystemMessage(content="s", timestamp=0).role == "system"
    assert types.UserMessage(content="u", timestamp=0).role == "user"
    assert types.AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=types.Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=types.UsageCost(input=0, output=0, cacheRead=0, cacheWrite=0, total=0),
        ),
        stopReason=types.StopReason.PENDING,
        timestamp=0,
    ).role == "assistant"
    assert (
        types.ToolResultMessage(
            toolCallId="id",
            toolName="tool",
            content=[],
            isError=False,
            timestamp=0,
        ).role
        == "toolResult"
    )


def test_usage_cost_is_nested_where_the_contract_puts_it() -> None:
    usage = types.Usage(
        input=1,
        output=2,
        cacheRead=3,
        cacheWrite=4,
        totalTokens=5,
        cost=types.UsageCost(input=0.1, output=0.2, cacheRead=0.0, cacheWrite=0.0, total=0.3),
        reasoning=1,
    )

    assert asdict(usage)["cost"]["total"] == 0.3
    assert usage.reasoning == 1


def test_events_expose_the_discriminant_the_stream_dispatches_on() -> None:
    partial = types.AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=types.Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=types.UsageCost(input=0, output=0, cacheRead=0, cacheWrite=0, total=0),
        ),
        stopReason=types.StopReason.PENDING,
        timestamp=0,
    )

    assert types.EventStart(partial=partial).type == "start"
    assert types.EventTextStart(contentIndex=0, partial=partial).type == "text_start"
    assert types.EventTextDelta(contentIndex=0, delta="d", partial=partial).type == "text_delta"
    assert types.EventTextEnd(contentIndex=0, content="c", partial=partial).type == "text_end"
    assert types.EventThinkingStart(contentIndex=0, partial=partial).type == "thinking_start"
    assert (
        types.EventThinkingDelta(contentIndex=0, delta="d", partial=partial).type
        == "thinking_delta"
    )
    assert (
        types.EventThinkingEnd(contentIndex=0, content="c", partial=partial).type
        == "thinking_end"
    )
    assert types.EventToolCallStart(contentIndex=0, partial=partial).type == "toolcall_start"
    assert (
        types.EventToolCallDelta(contentIndex=0, delta="{}", partial=partial).type
        == "toolcall_delta"
    )
    assert (
        types.EventToolCallEnd(
            contentIndex=0,
            toolCall=types.ToolCall(id="i", name="n", arguments={}),
            partial=partial,
        ).type
        == "toolcall_end"
    )
    assert types.EventDone(reason="stop", message=partial).type == "done"
    assert types.EventError(reason="error", error=partial).type == "error"


def test_event_payloads_mirror_the_protocol() -> None:
    partial = types.AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=types.Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=types.UsageCost(input=0, output=0, cacheRead=0, cacheWrite=0, total=0),
        ),
        stopReason=types.StopReason.PENDING,
        timestamp=0,
    )

    assert types.EventDone(reason="deferred", message=partial).message is partial
    assert types.EventError(reason="aborted", error=partial).error is partial
    assert types.EventTextDelta(contentIndex=2, delta="x", partial=partial).contentIndex == 2


def test_content_blocks_default_to_their_own_type() -> None:
    assert types.TextContent(text="t").type == "text"
    assert types.ThinkingContent(thinking="t").type == "thinking"
    assert types.ImageContent(data="d", mimeType="image/png").type == "image"
    assert types.ToolCall(id="i", name="n", arguments={}).type == "toolCall"


def test_text_content_keeps_its_optional_provider_metadata() -> None:
    assert types.TextContent(text="t", textSignature="sig").textSignature == "sig"
    assert types.TextContent(text="t").textSignature is None


def test_model_compat_is_one_value_covering_every_api() -> None:
    model = types.Model(
        id="m",
        name="M",
        api="openai-completions",
        provider="openai",
        baseUrl="https://example.test",
        reasoning=True,
        input=["text"],
        cost=types.ModelCost(input=1.0, output=2.0, cacheRead=0.0, cacheWrite=0.0),
        contextWindow=128_000,
        maxTokens=4_096,
        compat=types.OpenAICompletionsCompat(supportsStore=False),
    )

    assert isinstance(model.compat, types.OpenAICompletionsCompat)
    assert model.contextWindow == 128_000


def test_image_model_declares_its_own_outputs() -> None:
    model = types.ImagesModel(
        id="m",
        name="M",
        api="openrouter-images",
        provider="openrouter",
        baseUrl="https://example.test",
        input=["text"],
        output=["image"],
        cost=types.ModelCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0),
    )

    assert model.output == ["image"]


def test_stream_options_inherit_the_request_options() -> None:
    options = types.StreamOptions(
        apiKey="key",
        temperature=0.5,
        maxTokens=100,
        transport=types.Transport.SSE,
        cacheRetention=types.CacheRetention.SHORT,
    )

    assert options.apiKey == "key"
    assert options.maxTokens == 100
    assert options.transport == "sse"
    assert options.cacheRetention == "short"
    assert options.signal is None


def test_simple_stream_options_add_reasoning_without_losing_the_base() -> None:
    options = types.SimpleStreamOptions(
        reasoning=types.ThinkingLevel.HIGH,
        toolChoice=types.ToolChoice.NONE,
        deferred=types.DeferredWindow(window="1h"),
        thinkingBudgets=types.ThinkingBudgets(low=100, high=900),
    )

    assert options.reasoning == "high"
    assert options.toolChoice == "none"
    assert isinstance(options.deferred, types.DeferredWindow)
    assert options.thinkingBudgets is not None
    assert options.thinkingBudgets.high == 900


def test_api_option_types_cover_every_known_api() -> None:
    # A ``type`` alias keeps its definition in ``__value__``, so membership is checked
    # against the literal arguments the alias was built from.
    known = set(get_args(types.KnownApi.__value__))

    assert set(types.API_OPTION_TYPES) == known


def test_api_option_types_are_stream_options() -> None:
    for option_type in types.API_OPTION_TYPES.values():
        assert issubclass(option_type, types.StreamOptions)


def test_models_may_carry_unset_optional_fields() -> None:
    model = types.Model(
        id="m",
        name="M",
        api="custom",
        provider="custom",
        baseUrl="https://example.test",
        reasoning=False,
        input=["text"],
        cost=types.ModelCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0),
        contextWindow=1,
        maxTokens=1,
    )

    assert model.thinkingLevelMap is None
    assert model.samplingParams is None
    assert model.compat is None


def test_transcript_context_holds_only_the_normalized_messages() -> None:
    context = types.TranscriptContext(
        messages=[types.UserMessage(content="hello", timestamp=1)],
    )

    assert [field.name for field in fields(context)] == ["messages"]


def test_request_context_keeps_the_shorthand_entry_points() -> None:
    context = types.Context(
        messages=[types.UserMessage(content="hello", timestamp=1)],
        systemPrompt="be brief",
        tools=[types.Tool(name="t", description="d", parameters={"type": "object"})],
    )

    assert context.systemPrompt == "be brief"
    assert context.tools is not None
    assert context.tools[0].name == "t"
