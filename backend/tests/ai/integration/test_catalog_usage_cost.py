"""Exercise actual catalog loading and model lookup before calculating synthetic prices."""

import json
from decimal import Decimal

from app.ai.catalog import load_catalog
from app.ai.messages import Usage
from app.ai.models import create_models
from app.ai.providers.deepseek import deepseek_provider
from app.ai.usage import calculate_usage_cost


def test_loaded_catalog_precision_and_unknown_conditions_reach_cost_calculation():
    raw = [
        {
            "id": "synthetic",
            "name": "Synthetic",
            "provider": "deepseek",
            "api": "openai-completions",
            "context_window": 1024,
            "max_output_tokens": 128,
            "pricing": {
                "currency": "CNY",
                "input": "0.123456789",
                "output": "0",
                "cache_read": None,
                "cache_write": None,
                "tiers": [{"condition": "Documented condition", "input": "0.987654321"}],
            },
        }
    ]
    models = create_models([deepseek_provider(models=load_catalog(json.dumps(raw)))])
    model = models.get_model("deepseek", "synthetic")
    usage = Usage(input=1, output=0, cache_read=0, cache_write=0)
    assert calculate_usage_cost(usage, model.pricing).total is None
    cost = calculate_usage_cost(
        usage, model.pricing, condition_matches={"Documented condition": True}
    )
    assert cost.currency == "CNY" and cost.total == Decimal("0.000000987654321")
    base = calculate_usage_cost(
        usage, model.pricing, condition_matches={"Documented condition": False}
    )
    assert base.total == Decimal("0.000000123456789")
    assert model.pricing.input == Decimal("0.123456789")
