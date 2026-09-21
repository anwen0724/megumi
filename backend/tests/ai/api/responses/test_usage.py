"""Reported token accounting and independently calculated Decimal prices."""

from dataclasses import replace
from decimal import Decimal

import pytest

from app.ai import Context, Pricing, PricingTier, ResponsesOptions


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "native,expected",
    [
        (
            {
                "input_tokens": 100,
                "input_tokens_details": {"cached_tokens": 30, "cache_write_tokens": 10},
                "output_tokens": 20,
                "output_tokens_details": {"reasoning_tokens": 7},
                "total_tokens": 125,
            },
            (60, 20, 30, 10, 7, 125),
        ),
        ({"input_tokens": 100, "output_tokens": 20}, (None, 20, None, None, None, None)),
        (
            {
                "input_tokens": 0,
                "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                "output_tokens": 0,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": 0,
            },
            (0, 0, 0, 0, 0, 0),
        ),
    ],
)
async def test_usage_preserves_reported_total_and_unknowns(
    provider, sdk_harness, response_sse, native, expected
):
    data = response_sse(
        {
            "type": "response.completed",
            "response": {"id": "r", "status": "completed", "output": [], "usage": native},
        }
    )
    async with sdk_harness(data=data) as (models, http, _):
        final = await models.complete(
            provider.models[0],
            Context(messages=[]),
            ResponsesOptions(api_key="key", http_client=http),
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "request_tier,response_tier,hook_tier,conditional,expected",
    [
        ("priority", "default", None, False, Decimal("0.0024")),
        ("default", None, None, False, Decimal("0.0024")),
        ("default", "priority", None, False, None),
        ("priority", None, "default", False, Decimal("0.0024")),
        ("default", None, None, True, None),
    ],
)
async def test_price_uses_effective_response_or_actual_request_tier(
    provider,
    sdk_harness,
    response_sse,
    request_tier,
    response_tier,
    hook_tier,
    conditional,
    expected,
):
    pricing = Pricing(
        input=Decimal("2"),
        output=Decimal("4"),
        cache_read=Decimal("0.5"),
        tiers=(PricingTier(condition="unknown", input=Decimal("9")),) if conditional else (),
    )
    model = replace(provider.models[0], provider="openai", pricing=pricing)
    configured = replace(provider, id="openai", models=[model])
    native = {
        "id": "r",
        "status": "completed",
        "output": [],
        "usage": {
            "input_tokens": 1000,
            "input_tokens_details": {"cached_tokens": 400},
            "output_tokens": 250,
            "total_tokens": 1250,
        },
    }
    if response_tier:
        native["service_tier"] = response_tier
    data = response_sse({"type": "response.completed", "response": native})
    async with sdk_harness(data=data, providers=[configured]) as (models, http, _):
        final = await models.complete(
            model,
            Context(messages=[]),
            ResponsesOptions(
                api_key="key",
                http_client=http,
                service_tier=request_tier,
                on_payload=(lambda body, _: {**body, "service_tier": hook_tier})
                if hook_tier
                else None,
            ),
        )
        assert final.stop_reason == "stop", final.error_message
        assert final.usage.input == 600 and final.usage.cache_write == 0
        assert final.usage.cost is not None
        assert final.usage.cost.total == expected
        if expected is not None:
            assert final.usage.cost.input == Decimal("0.0012")
            assert final.usage.cost.output == Decimal("0.001")
            assert final.usage.cost.cache_read == Decimal("0.0002")
