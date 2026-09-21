"""Verify native delta assembly and stable public content slots."""

import json

import pytest

from app.ai import CompletionsOptions, Context, TextContent, ThinkingContent


@pytest.mark.asyncio
async def test_interleaved_text_reasoning_uses_stable_slots(provider, sdk_harness, native_sse):
    data = native_sse(
        {"choices": [{"delta": {"reasoning_content": "A", "reasoning": "duplicate"}}]},
        {"choices": [{"delta": {"content": "B"}}]},
        {"choices": [{"delta": {"reasoning_text": "C"}}]},
        {"choices": [{"delta": {"content": "D"}, "finish_reason": "stop"}]},
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert final.content == [
            ThinkingContent(thinking="AC", thinking_signature="reasoning_content"),
            TextContent(text="BD"),
        ]
        deltas = [
            (e["type"], e["content_index"], e["delta"])
            for e in events
            if e["type"].endswith("_delta")
        ]
        assert deltas == [
            ("thinking_delta", 0, "A"),
            ("text_delta", 1, "B"),
            ("thinking_delta", 0, "C"),
            ("text_delta", 1, "D"),
        ]
        assert all(e["partial"] is response.partial for e in events if "partial" in e)
        assert [e["type"] for e in events][-3:] == ["thinking_end", "text_end", "done"]


@pytest.mark.asyncio
async def test_structured_reasoning_is_replay_metadata_not_visible_delta(
    provider, sdk_harness, native_sse
):
    details = [
        {"type": "reasoning.text", "text": "a"},
        {"type": "reasoning.text", "text": "b", "signature": "sig", "id": "r"},
        {"type": "reasoning.encrypted", "data": "opaque1"},
        {"type": "reasoning.encrypted", "data": "opaque2"},
        {"type": "reasoning.summary", "summary": "c"},
        {"type": "reasoning.summary", "summary": "d", "index": 1},
        {"type": "unknown", "data": "ignore"},
    ]
    data = native_sse(
        *[{"choices": [{"delta": {"reasoning_details": [detail]}}]} for detail in details],
        {"choices": [{"delta": {"content": "answer"}, "finish_reason": "stop"}]},
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert isinstance(final.content[0], ThinkingContent)
        assert final.content[0].thinking == ""
        assert json.loads(final.content[0].thinking_signature) == [
            {"type": "reasoning.text", "text": "ab", "signature": "sig", "id": "r"},
            {"type": "reasoning.encrypted", "data": "opaque1"},
            {"type": "reasoning.encrypted", "data": "opaque2"},
            {"type": "reasoning.summary", "summary": "cd", "index": 1},
        ]
        assert not any(e["type"] == "thinking_delta" for e in events)


@pytest.mark.asyncio
async def test_parallel_tools_late_identity_and_split_json(provider, sdk_harness, native_sse):
    import httpx2

    from app.ai import ToolCall

    data = native_sse(
        {
            "choices": [
                {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"city":"'}}]}}
            ]
        },
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 1,
                                "id": "b",
                                "function": {"name": "count", "arguments": '{"n":2}'},
                            }
                        ]
                    }
                }
            ]
        },
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "a",
                                "function": {"name": "weather", "arguments": '北京"}'},
                            }
                        ]
                    }
                }
            ]
        },
        {
            "choices": [
                {
                    "delta": {"tool_calls": [{"id": "b", "function": {"arguments": " "}}]},
                    "finish_reason": "stop",
                }
            ]
        },
    )

    class SplitBody(httpx2.AsyncByteStream):
        async def __aiter__(self):
            for offset in range(0, len(data), 7):
                yield data[offset : offset + 7]

    async def handler(request):
        return httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, stream=SplitBody()
        )

    async with sdk_harness(handler=handler) as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert final.content == [
            ToolCall(id="a", name="weather", arguments={"city": "北京"}),
            ToolCall(id="b", name="count", arguments={"n": 2}),
        ]
        assert [
            (e["content_index"], e["delta"]) for e in events if e["type"] == "toolcall_delta"
        ] == [(0, '{"city":"'), (1, '{"n":2}'), (0, '北京"}'), (1, " ")]
        assert [e["tool_call"] for e in events if e["type"] == "toolcall_end"] == final.content


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw,expected",
    [
        ('{"q":"unfinished', {"q": "unfinished"}),
        ('{"q":"line\nnext"}', {"q": "line\nnext"}),
        ('{"n":null}', {"n": None}),
    ],
)
async def test_tool_end_keeps_repaired_or_partial_arguments(
    provider, sdk_harness, native_sse, raw, expected
):
    data = native_sse(
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "c",
                                "function": {"name": "lookup", "arguments": raw},
                            }
                        ]
                    },
                    "finish_reason": "stop",
                }
            ]
        }
    )
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        events = [e async for e in response]
        final = await response.result()
        assert final.stop_reason == "stop", final.error_message
        assert final.content[0].arguments == expected
        assert (
            next(e["tool_call"].arguments for e in events if e["type"] == "toolcall_end")
            == expected
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "native,expected",
    [
        ("stop", "stop"),
        ("end", "stop"),
        ("length", "length"),
        ("function_call", "tool_use"),
        ("tool_calls", "tool_use"),
        ("content_filter", "error"),
        ("network_error", "error"),
        ("new_reason", "error"),
    ],
)
async def test_native_finish_reason_is_preserved(
    provider, sdk_harness, native_sse, native, expected
):
    data = native_sse({"choices": [{"delta": {"content": "partial"}, "finish_reason": native}]})
    async with sdk_harness(data=data) as (models, http, _):
        response = models.stream(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        final = await response.result()
        assert final.stop_reason == expected, final.error_message
        assert final.raw_stop_reason == native
        assert final.content == [TextContent(text="partial")]
        assert sum(e["type"] in ("done", "error") for e in [e async for e in response]) == 1
        if expected == "error":
            assert native in final.error_message


@pytest.mark.asyncio
@pytest.mark.parametrize("tools", [False, True])
async def test_explicit_no_finish_compat_infers_terminal(provider, sdk_harness, native_sse, tools):
    from dataclasses import replace

    from app.ai import ModelCompat

    model = replace(provider.models[0], compat=ModelCompat(supports_finish_reason=False))
    delta = (
        {
            "tool_calls": [
                {"index": 0, "id": "a", "function": {"name": "call", "arguments": '{"x":1'}}
            ]
        }
        if tools
        else {"content": "text"}
    )
    async with sdk_harness(
        providers=[replace(provider, models=[model])],
        data=native_sse({"choices": [{"delta": delta}]}),
    ) as (models, http, _):
        final = await models.complete(
            model, Context(messages=[]), CompletionsOptions(api_key="key", http_client=http)
        )
        assert final.stop_reason == ("tool_use" if tools else "stop"), final.error_message
        assert final.raw_stop_reason is None
