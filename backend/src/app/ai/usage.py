"""Calculate monetary components from reported counts and applicable catalog prices."""

from collections.abc import Mapping
from decimal import Decimal

from app.ai.messages import Usage, UsageCost
from app.ai.model import Pricing, PricingTier


def calculate_usage_cost(
    usage: Usage,
    pricing: Pricing,
    *,
    response_service_tier: str | None = None,
    request_service_tier: str | None = None,
    condition_matches: Mapping[str, bool | None] | None = None,
) -> UsageCost:
    """Return independent Decimal costs; reasoning is already included in output."""
    effective_tier = (
        response_service_tier if response_service_tier is not None else request_service_tier
    )
    selected = _applicable_rates(pricing, effective_tier, condition_matches or {})

    def component(count: int | None, rate: Decimal | None) -> Decimal | None:
        """Preserve unknown counts/rates while allowing a known zero count to cost zero."""
        if count == 0:
            return Decimal(0)
        if count is None or rate is None:
            return None
        return Decimal(count) * rate / Decimal(pricing.unit_tokens)

    parts = [
        component(getattr(usage, name), getattr(selected, name) if selected is not None else None)
        for name in ("input", "output", "cache_read", "cache_write")
    ]
    total = (
        sum((value for value in parts if value is not None), Decimal(0))
        if all(value is not None for value in parts)
        else None
    )
    return UsageCost(
        currency=pricing.currency,
        input=parts[0],
        output=parts[1],
        cache_read=parts[2],
        cache_write=parts[3],
        total=total,
    )


def _applicable_rates(
    pricing: Pricing, service_tier: str | None, matches: Mapping[str, bool | None]
) -> Pricing | PricingTier | None:
    """Select only proven rates; condition labels are keys, never parsed billing rules.

    Matches must describe applicability under the effective response/request tier.
    Unknown or competing applicable conditions cannot establish a unique price.
    """
    selected: list[PricingTier] = []
    for tier in pricing.tiers:
        match = matches.get(tier.condition)
        if match is None:
            return None
        if match:
            selected.append(tier)
    if selected:
        return selected[0] if len(selected) == 1 else None
    return pricing if service_tier in (None, "default", "standard") else None
