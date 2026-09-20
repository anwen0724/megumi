"""Costs use catalog Decimal rates without converting unknown counts into zero."""

from decimal import Decimal

from app.ai.messages import Usage, UsageCost
from app.ai.model import Pricing, PricingTier
from app.ai.usage import calculate_usage_cost


def test_four_components_are_priced_once_using_the_declared_currency_and_unit():
    usage = Usage(input=1000, output=500, cache_read=200, cache_write=0, reasoning=100)
    pricing = Pricing(
        currency="CNY",
        input=Decimal("2"),
        output=Decimal("8"),
        cache_read=Decimal("0.5"),
        cache_write=Decimal("3"),
    )
    assert calculate_usage_cost(usage, pricing) == UsageCost(
        currency="CNY",
        input=Decimal("0.002"),
        output=Decimal("0.004"),
        cache_read=Decimal("0.0001"),
        cache_write=Decimal("0"),
        total=Decimal("0.0061"),
    )
    assert usage.cost is None


def test_unknown_rates_counts_and_known_zero_remain_distinct():
    usage = Usage(input=None, output=2, cache_read=0, cache_write=0)
    result = calculate_usage_cost(usage, Pricing(input=Decimal(0)))
    assert result.input is None and result.output is None
    assert result.cache_read == result.cache_write == Decimal(0)
    assert result.total is None
    result = calculate_usage_cost(
        Usage(input=1, output=0, cache_read=0, cache_write=0),
        Pricing(input=Decimal("0.123456789"), unit_tokens=1000),
    )
    assert result.total == Decimal("0.000123456789")


def test_unknown_conditions_do_not_fall_back_to_a_known_base_price():
    usage = Usage(input=100, output=0, cache_read=0, cache_write=0)
    pricing = Pricing(
        input=Decimal(2), tiers=(PricingTier(condition="documented time", input=Decimal(1)),)
    )
    result = calculate_usage_cost(usage, pricing)
    assert result.input is None and result.total is None
    assert result.output == 0


def test_response_tier_takes_precedence_and_conditional_prices_require_evidence():
    usage = Usage(input=1000, output=0, cache_read=0, cache_write=0)
    pricing = Pricing(input=Decimal(2))
    assert calculate_usage_cost(usage, pricing, request_service_tier="priority").input is None
    assert calculate_usage_cost(
        usage, pricing, request_service_tier="priority", response_service_tier="default"
    ).input == Decimal("0.002")
    assert (
        calculate_usage_cost(
            usage, pricing, request_service_tier="default", response_service_tier="priority"
        ).input
        is None
    )
    condition = "Applicable documented priority rate"
    conditional = Pricing(
        input=Decimal(2), tiers=(PricingTier(condition=condition, input=Decimal(4)),)
    )
    assert calculate_usage_cost(
        usage, conditional, response_service_tier="priority", condition_matches={condition: True}
    ).input == Decimal("0.004")
    assert calculate_usage_cost(
        usage, conditional, response_service_tier="default", condition_matches={condition: False}
    ).input == Decimal("0.002")
    assert (
        calculate_usage_cost(
            usage,
            conditional,
            response_service_tier="priority",
            condition_matches={condition: False},
        ).input
        is None
    )
