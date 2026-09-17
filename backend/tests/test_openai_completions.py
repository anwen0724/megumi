"""End-to-end tests for the completions adapter.

These drive the adapter with a scripted chunk stream instead of a network, because the
point being tested is the translation from the protocol's vocabulary to the layer's: the
event sequence, the live `partial` message, tool-call argument assembly across chunks, and
the stop reasons and usage the terminal event carries.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import pytest

from app.ai.api.openai_completions import (
    OpenedStream,
    StreamRequest,
    calculate_cost,
    map_stop_reason,
    parse_chunk_usage,
    resolve_compat,
    stream,
)
from app.ai.types import (
    Context,
    Model,
    ModelCost,
    OpenAICompletionsCompat,
    ProviderResponse,
    StopReason,
    TextContent,
    ThinkingContent,
    ToolCall,
    Usage,
)
from app.ai.utils.transcript import normalize_context


def make_model(
    *,
    provider: str = "deepseek",
    model_id: str = "deepseek-chat",
    input_types: list[Any] | None = None,
    compat: OpenAICompletionsCompat | None = None,
) -> Model:
    """A model shaped like the ones this adapter is used with."""

    return Model(
        id=model_id,
        name=model_id,
        api="openai-completions",
        provider=provider,
        baseUrl="https://api.deepseek.test/v1",
        reasoning=False,
        input=input_types or ["text"],
        cost=ModelCost(input=1.0, output=2.0, cacheRead=0.1, cacheWrite=1.0),
        contextWindow=64_000,
        maxTokens=4_096,
        compat=compat,
    )


def context_with(text: str) -> Any:
    """A normalized transcript carrying one user turn."""

    from app.ai.types import UserMessage

    return normalize_context(
        Context(messages=[UserMessage(content=text, timestamp=1)], systemPrompt="be brief"),
    )


@dataclass
class FakeTransport:
    """Replays scripted chunks, and records the request it was given."""

    chunks: list[dict[str, Any]]
    requests: list[StreamRequest]

    async def __call__(self, request: StreamRequest) -> OpenedStream:
        self.requests.append(request)

        async def iterate() -> AsyncIterator[dict[str, Any]]:
            for chunk in self.chunks:
                yield chunk

        return OpenedStream(
            response=ProviderResponse(status=200, headers={"content-type": "text/event-stream"}),
            chunks=iterate(),
        )


def transport_for(chunks: list[dict[str, Any]]) -> FakeTransport:
    return FakeTransport(chunks=chunks, requests=[])


def text_chunks() -> list[dict[str, Any]]:
    """A plain streaming answer, one delta at a time."""

    return [
        {"id": "resp_1", "model": "deepseek-chat", "choices": [{"delta": {"content": "He"}}]},
        {"id": "resp_1", "choices": [{"delta": {"content": "llo"}}]},
        {
            "id": "resp_1",
            "choices": [{"delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2},
        },
    ]


@pytest.mark.asyncio
async def test_plain_answer_produces_the_expected_event_sequence() -> None:
    transport = transport_for(text_chunks())

    result = stream(make_model(), context_with("hi"), None, transport)

    events = [event.type async for event in result]

    assert events == ["start", "text_start", "text_delta", "text_delta", "text_end", "done"]


@pytest.mark.asyncio
async def test_the_terminal_message_matches_what_the_events_reported() -> None:
    transport = transport_for(text_chunks())

    result = stream(make_model(), context_with("hi"), None, transport)
    message = await result.result()

    assert message.stopReason == StopReason.STOP
    assert len(message.content) == 1
    block = message.content[0]
    assert isinstance(block, TextContent)
    assert block.text == "Hello"
    assert message.responseId == "resp_1"


@pytest.mark.asyncio
async def test_events_carry_the_same_live_message_object() -> None:
    # The events share one message that grows as chunks arrive, so a consumer that keeps a
    # reference sees later content in an earlier event. Batch consumers must copy it.
    transport = transport_for(text_chunks())

    result = stream(make_model(), context_with("hi"), None, transport)
    seen: list[Any] = []
    async for event in result:
        if event.type == "text_delta":
            seen.append(event.partial)

    assert seen[0] is seen[1]
    assert seen[0] is await result.result()
    # Both deltas were emitted after their text was appended, so the shared message already
    # holds the whole answer by the time either event is observed.
    assert seen[0].content[0].text == "Hello"


@pytest.mark.asyncio
async def test_usage_is_reported_and_priced() -> None:
    transport = transport_for(text_chunks())

    result = stream(make_model(), context_with("hi"), None, transport)
    message = await result.result()

    assert message.usage.input == 10
    assert message.usage.output == 2
    assert message.usage.totalTokens == 12
    # Rates are per million tokens.
    assert message.usage.cost.input == pytest.approx(10 / 1_000_000)


@pytest.mark.asyncio
async def test_tool_call_arguments_assemble_across_chunks() -> None:
    # The arguments arrive as four fragments, so each delta must parse what is complete so
    # far without raising.
    chunks = [
        {
            "id": "r",
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "function": {"name": "read_file", "arguments": '{"pa'},
                            },
                        ],
                    },
                },
            ],
        },
        {
            "choices": [
                {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'th":"RE'}}]}},
            ],
        },
        {
            "choices": [
                {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ADME.md"}'}}]}},
            ],
        },
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ]
    transport = transport_for(chunks)

    result = stream(make_model(), context_with("read it"), None, transport)
    events = [event.type async for event in result]

    assert events == [
        "start",
        "toolcall_start",
        "toolcall_delta",
        "toolcall_delta",
        "toolcall_delta",
        "toolcall_end",
        "done",
    ]


@pytest.mark.asyncio
async def test_a_finished_tool_call_carries_parsed_arguments() -> None:
    chunks = [
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "function": {"name": "read_file", "arguments": '{"path":"a.txt"}'},
                            },
                        ],
                    },
                },
            ],
        },
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ]
    transport = transport_for(chunks)

    result = stream(make_model(), context_with("go"), None, transport)
    message = await result.result()

    assert message.stopReason == StopReason.TOOL_USE
    block = message.content[0]
    assert isinstance(block, ToolCall)
    assert block.id == "call_1"
    assert block.name == "read_file"
    assert block.arguments == {"path": "a.txt"}


@pytest.mark.asyncio
async def test_reasoning_content_becomes_a_thinking_block() -> None:
    chunks = [
        {"choices": [{"delta": {"reasoning_content": "Let me "}}]},
        {"choices": [{"delta": {"reasoning_content": "think."}}]},
        {"choices": [{"delta": {"content": "Answer"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    transport = transport_for(chunks)

    result = stream(make_model(), context_with("why"), None, transport)
    events = [event.type async for event in result]
    message = await result.result()

    assert events[:4] == [
        "start",
        "thinking_start",
        "thinking_delta",
        "thinking_delta",
    ]
    thinking = message.content[0]
    assert isinstance(thinking, ThinkingContent)
    assert thinking.thinking == "Let me think."
    assert thinking.thinkingSignature == "reasoning_content"


@pytest.mark.asyncio
async def test_the_first_non_empty_reasoning_field_wins() -> None:
    # Some servers report the same text under two names; it must not be counted twice.
    chunks = [
        {"choices": [{"delta": {"reasoning_content": "once", "reasoning": "once"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    transport = transport_for(chunks)

    message = await stream(make_model(), context_with("q"), None, transport).result()

    thinking = message.content[0]
    assert isinstance(thinking, ThinkingContent)
    assert thinking.thinking == "once"


@pytest.mark.asyncio
async def test_usage_on_the_choice_is_accepted() -> None:
    # Some servers report usage on the choice rather than on the chunk.
    chunks = [
        {"choices": [{"delta": {"content": "x"}}]},
        {
            "choices": [
                {
                    "delta": {},
                    "finish_reason": "stop",
                    "usage": {"prompt_tokens": 7, "completion_tokens": 1},
                },
            ],
        },
    ]
    transport = transport_for(chunks)

    message = await stream(make_model(), context_with("q"), None, transport).result()

    assert message.usage.input == 7
    assert message.usage.output == 1


@pytest.mark.asyncio
async def test_a_served_model_different_from_the_requested_one_is_recorded() -> None:
    chunks = [
        {"id": "r", "model": "deepseek-chat-v3", "choices": [{"delta": {"content": "x"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    transport = transport_for(chunks)

    message = await stream(make_model(), context_with("q"), None, transport).result()

    assert message.responseModel == "deepseek-chat-v3"


@pytest.mark.asyncio
async def test_content_filter_stops_with_an_error_message() -> None:
    chunks = [{"choices": [{"delta": {}, "finish_reason": "content_filter"}]}]
    transport = transport_for(chunks)

    result = stream(make_model(), context_with("q"), None, transport)
    events = [event.type async for event in result]
    message = await result.result()

    assert events == ["start", "error"]
    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage == "Provider finish_reason: content_filter"


@pytest.mark.asyncio
async def test_an_unknown_finish_reason_is_an_error() -> None:
    chunks = [{"choices": [{"delta": {}, "finish_reason": "something_new"}]}]
    transport = transport_for(chunks)

    message = await stream(make_model(), context_with("q"), None, transport).result()

    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage == "Provider finish_reason: something_new"


@pytest.mark.asyncio
async def test_a_stream_without_a_finish_reason_fails() -> None:
    chunks = [{"choices": [{"delta": {"content": "partial"}}]}]
    transport = transport_for(chunks)

    message = await stream(make_model(), context_with("q"), None, transport).result()

    assert message.stopReason == StopReason.ERROR
    assert message.errorMessage is not None
    assert "finish_reason" in message.errorMessage


@pytest.mark.asyncio
async def test_an_absent_finish_reason_is_inferred_when_the_server_cannot_report_one() -> None:
    chunks = [{"choices": [{"delta": {"content": "done"}}]}]
    transport = transport_for(chunks)
    model = make_model(compat=OpenAICompletionsCompat(supportsFinishReason=False))

    message = await stream(model, context_with("q"), None, transport).result()

    assert message.stopReason == StopReason.STOP


@pytest.mark.asyncio
async def test_a_server_that_cannot_report_a_finish_reason_infers_tool_use() -> None:
    chunks = [
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "c",
                                "function": {"name": "t", "arguments": "{}"},
                            },
                        ],
                    },
                },
            ],
        },
    ]
    transport = transport_for(chunks)
    model = make_model(compat=OpenAICompletionsCompat(supportsFinishReason=False))

    message = await stream(model, context_with("q"), None, transport).result()

    assert message.stopReason == StopReason.TOOL_USE


@pytest.mark.asyncio
async def test_an_empty_stream_fails() -> None:
    transport = transport_for([])

    message = await stream(make_model(), context_with("q"), None, transport).result()

    assert message.stopReason == StopReason.ERROR


@pytest.mark.asyncio
async def test_the_request_is_built_from_the_transcript() -> None:
    transport = transport_for(text_chunks())

    await stream(make_model(), context_with("hello there"), None, transport).result()

    assert len(transport.requests) == 1
    request = transport.requests[0]
    assert request.url == "https://api.deepseek.test/v1/chat/completions"
    assert request.body["model"] == "deepseek-chat"
    assert request.body["stream"] is True
    messages = request.body["messages"]
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == "be brief"
    assert messages[-1] == {"role": "user", "content": "hello there"}


@pytest.mark.asyncio
async def test_usage_in_streaming_is_requested_by_default() -> None:
    transport = transport_for(text_chunks())

    await stream(make_model(), context_with("q"), None, transport).result()

    assert transport.requests[0].body["stream_options"] == {"include_usage": True}


class TestUsageParsing:
    def test_reads_openai_style_details(self) -> None:
        usage = parse_chunk_usage(
            {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "prompt_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 5},
                "completion_tokens_details": {"reasoning_tokens": 7},
            },
            make_model(),
        )

        assert usage.cacheRead == 40
        assert usage.cacheWrite == 5
        # The prompt count already includes the cache counters.
        assert usage.input == 55
        assert usage.output == 20
        assert usage.reasoning == 7
        assert usage.totalTokens == 120

    def test_reads_deepseek_style_cache_hits(self) -> None:
        usage = parse_chunk_usage(
            {"prompt_tokens": 100, "completion_tokens": 1, "prompt_cache_hit_tokens": 30},
            make_model(),
        )

        assert usage.cacheRead == 30
        assert usage.input == 70

    def test_reads_a_top_level_cached_tokens(self) -> None:
        usage = parse_chunk_usage(
            {"prompt_tokens": 10, "cached_tokens": 4},
            make_model(),
        )

        assert usage.cacheRead == 4
        assert usage.input == 6

    def test_input_never_goes_negative(self) -> None:
        usage = parse_chunk_usage(
            {"prompt_tokens": 1, "prompt_tokens_details": {"cached_tokens": 9}},
            make_model(),
        )

        assert usage.input == 0


class TestCost:
    def test_prices_each_class_of_token(self) -> None:
        usage = Usage(
            input=1_000_000,
            output=1_000_000,
            cacheRead=1_000_000,
            cacheWrite=1_000_000,
            totalTokens=4_000_000,
            cost=_zero_cost(),
        )

        cost = calculate_cost(make_model(), usage)

        assert cost.input == pytest.approx(1.0)
        assert cost.output == pytest.approx(2.0)
        assert cost.cacheRead == pytest.approx(0.1)
        assert cost.cacheWrite == pytest.approx(1.0)
        assert cost.total == pytest.approx(4.1)

    def test_a_one_hour_cache_write_costs_double_the_input_rate(self) -> None:
        usage = Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=1_000_000,
            totalTokens=1_000_000,
            cost=_zero_cost(),
            cacheWrite1h=1_000_000,
        )

        cost = calculate_cost(make_model(), usage)

        assert cost.cacheWrite == pytest.approx(2.0)

    def test_the_highest_matching_tier_applies_to_the_whole_request(self) -> None:
        from app.ai.types import ModelCostTier

        model = make_model()
        model.cost.tiers = [
            ModelCostTier(
                input=2.0, output=2.0, cacheRead=0.0, cacheWrite=0.0, inputTokensAbove=100,
            ),
            ModelCostTier(
                input=5.0, output=5.0, cacheRead=0.0, cacheWrite=0.0, inputTokensAbove=1000,
            ),
        ]
        usage = Usage(
            input=1_000_000,
            output=1_000_000,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=2_000_000,
            cost=_zero_cost(),
        )

        cost = calculate_cost(model, usage)

        # A million input tokens is above both thresholds, so the higher tier prices all of it.
        assert cost.input == pytest.approx(5.0)


def _zero_cost() -> Any:
    from app.ai.types import UsageCost

    return UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0)


class TestStopReasonMapping:
    @pytest.mark.parametrize(
        ("reason", "expected"),
        [
            (None, StopReason.STOP),
            ("stop", StopReason.STOP),
            ("end", StopReason.STOP),
            ("length", StopReason.LENGTH),
            ("tool_calls", StopReason.TOOL_USE),
            ("function_call", StopReason.TOOL_USE),
            ("content_filter", StopReason.ERROR),
            ("network_error", StopReason.ERROR),
        ],
    )
    def test_maps_known_reasons(self, reason: Any, expected: StopReason) -> None:
        assert map_stop_reason(reason)[0] == expected

    def test_reports_the_reason_it_could_not_map(self) -> None:
        assert map_stop_reason("weird")[1] == "Provider finish_reason: weird"


class TestCompat:
    def test_fills_defaults_for_an_unset_model(self) -> None:
        compat = resolve_compat(make_model())

        assert compat.supportsFinishReason is not False
        assert compat.maxTokensField == "max_completion_tokens"

    def test_keeps_what_the_model_declares(self) -> None:
        model = make_model(compat=OpenAICompletionsCompat(supportsFinishReason=False))

        assert resolve_compat(model).supportsFinishReason is False
