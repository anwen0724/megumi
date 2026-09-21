"""Observe trailing native usage and independently calculated token costs."""

import asyncio
from dataclasses import replace
from decimal import Decimal

import httpx2
import pytest

from app.ai import CompletionsOptions, Context, Pricing, Usage


@pytest.mark.asyncio
async def test_finish_waits_for_trailing_usage(provider, sdk_harness, native_sse):
    reached, release = asyncio.Event(), asyncio.Event()
    model = replace(
        provider.models[0],
        pricing=Pricing(
            input=Decimal("2"),
            output=Decimal("4"),
            cache_read=Decimal("0.5"),
            cache_write=Decimal("3"),
        ),
    )

    class Body(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'
            reached.set()
            await release.wait()
            yield native_sse(
                {
                    "choices": [],
                    "usage": {
                        "prompt_tokens": 100,
                        "completion_tokens": 20,
                        "total_tokens": 999,
                        "prompt_tokens_details": {"cached_tokens": 30, "cache_write_tokens": 10},
                        "completion_tokens_details": {"reasoning_tokens": 8},
                    },
                }
            )

    async def handler(request):
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, stream=Body())

    async with sdk_harness(providers=[replace(provider, models=[model])], handler=handler) as (
        models,
        http,
        _,
    ):
        response = models.stream(
            model, Context(messages=[]), CompletionsOptions(api_key="key", http_client=http)
        )
        result = asyncio.create_task(response.result())
        await asyncio.wait_for(reached.wait(), 1)
        assert not result.done()
        release.set()
        final = await result
        assert final.stop_reason == "stop", final.error_message
        assert (
            final.usage.input,
            final.usage.output,
            final.usage.cache_read,
            final.usage.cache_write,
            final.usage.reasoning,
            final.usage.total_tokens,
        ) == (60, 20, 30, 10, 8, 120)
        assert final.usage.cost.input == Decimal("0.00012")
        assert final.usage.cost.output == Decimal("0.00008")
        assert final.usage.cost.cache_read == Decimal("0.000015")
        assert final.usage.cost.cache_write == Decimal("0.00003")
        assert final.usage.cost.total == Decimal("0.000245")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "location,raw,expected",
    [
        (
            "chunk",
            {"prompt_tokens": 10, "completion_tokens": 4, "prompt_cache_hit_tokens": 3},
            (7, 4, 3, 0, None, 14),
        ),
        (
            "choice",
            {"prompt_tokens": 10, "completion_tokens": 4, "cached_tokens": 5},
            (5, 4, 5, 0, None, 14),
        ),
        (
            "chunk",
            {
                "prompt_tokens": 10,
                "completion_tokens": 4,
                "prompt_tokens_details": {"cached_tokens": 0},
                "prompt_cache_hit_tokens": 3,
                "cached_tokens": 5,
            },
            (10, 4, 0, 0, None, 14),
        ),
        (
            "chunk",
            {"prompt_tokens": 2, "completion_tokens": 4, "prompt_cache_hit_tokens": 3},
            (0, 4, 3, 0, None, 7),
        ),
        ("chunk", {"prompt_tokens": 10}, (None, None, None, 0, None, None)),
        (
            "chunk",
            {"prompt_tokens": 0, "completion_tokens": 0, "prompt_cache_hit_tokens": 0},
            (0, 0, 0, 0, None, 0),
        ),
    ],
)
async def test_deepseek_usage_sources_and_unknown_counts(
    sdk_harness, native_sse, location, raw, expected
):
    from app.ai import deepseek_provider

    provider = deepseek_provider()
    chunk = {"choices": [{"delta": {}, "finish_reason": "stop"}]}
    if location == "choice":
        chunk["choices"][0]["usage"] = raw
    else:
        chunk["usage"] = raw
        chunk["choices"][0]["usage"] = {"prompt_tokens": 999, "completion_tokens": 999}
    async with sdk_harness(providers=[provider], data=native_sse(chunk)) as (models, http, _):
        final = await models.complete(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        assert final.stop_reason == "stop", final.error_message
        usage = final.usage
        assert (
            usage.input,
            usage.output,
            usage.cache_read,
            usage.cache_write,
            usage.reasoning,
            usage.total_tokens,
        ) == expected
        # The catalog has conditional rates; no clock/holiday condition is invented.
        assert usage.cost.total == (Decimal(0) if expected[-1] == 0 else None)


@pytest.mark.asyncio
async def test_unreported_usage_stays_unknown(provider, sdk_harness):
    async with sdk_harness() as (models, http, _):
        final = await models.complete(
            provider.models[0],
            Context(messages=[]),
            CompletionsOptions(api_key="key", http_client=http),
        )
        assert final.usage == Usage()
