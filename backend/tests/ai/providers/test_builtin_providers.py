"""Built-in catalogs obey the same provider contract as custom catalogs."""

import json
from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from app.ai.catalog import load_catalog
from app.ai.errors import ConfigurationError
from app.ai.models import create_models
from app.ai.providers.deepseek import deepseek_provider
from app.ai.providers.openai import openai_provider


@pytest.mark.parametrize(
    ("factory", "identity", "api", "env_var", "base_url"),
    [
        (
            deepseek_provider,
            "deepseek",
            "openai-completions",
            "DEEPSEEK_API_KEY",
            "https://api.deepseek.com",
        ),
        (
            openai_provider,
            "openai",
            "openai-responses",
            "OPENAI_API_KEY",
            "https://api.openai.com/v1",
        ),
    ],
)
def test_builtin_catalog_has_valid_identity_metadata_and_sources(
    factory, identity, api, env_var, base_url
):
    provider = factory()
    assert (provider.id, provider.api, provider.env_var, provider.base_url) == (
        identity,
        api,
        env_var,
        base_url,
    )
    models = create_models([provider]).get_models(identity)
    assert models
    for model in models:
        assert model.provider == identity
        assert model.api == api
        assert model.context_window > 0
        assert model.max_output_tokens > 0
        assert model.source is not None
        assert model.source.url.startswith("https://")
        assert date.fromisoformat(model.source.checked_at) <= date.today()


@pytest.mark.parametrize("factory", [deepseek_provider, openai_provider])
def test_custom_catalog_replaces_defaults_and_uses_common_validation(factory):
    original = factory()
    custom = replace(original.models[0], id="private-model")
    headers = {"X-Gateway": "local"}
    configured = factory(models=[custom], base_url="http://localhost:8080/v1", headers=headers)
    headers["X-Gateway"] = "changed"
    collection = create_models([configured])
    assert collection.get_model(original.id, original.models[0].id) is None
    assert [model.id for model in collection.get_models()] == ["private-model"]
    assert configured.base_url == "http://localhost:8080/v1"
    assert configured.headers == {"X-Gateway": "local"}
    assert factory(models=[]).models == []
    with pytest.raises(ConfigurationError):
        factory(models=[custom, custom])
    with pytest.raises(ConfigurationError):
        factory(headers={"Authorization": "fake-not-allowed"})


def test_catalog_preserves_conditional_prices_and_sampling_support():
    data = [
        {
            "id": "conditional",
            "name": "Conditional",
            "provider": "deepseek",
            "api": "openai-completions",
            "context_window": 1024,
            "max_output_tokens": 128,
            "pricing": {
                "tiers": [
                    {
                        "condition": "A documented billing condition",
                        "input": "0.123456789",
                        "output": "0",
                        "cache_read": None,
                    }
                ],
            },
            "compat": {"temperature_requires_reasoning_off": True},
        }
    ]
    provider = deepseek_provider(models=load_catalog(json.dumps(data)))
    model = provider.models[0]
    assert model.pricing.input is None
    tier = model.pricing.tiers[0]
    assert tier.condition == "A documented billing condition"
    assert tier.input == Decimal("0.123456789")
    assert tier.output == Decimal("0")
    assert tier.cache_read is None
    assert model.compat.temperature_requires_reasoning_off is True
    data[0]["pricing"]["tiers"][0]["input"] = "-1"
    with pytest.raises(ConfigurationError):
        deepseek_provider(models=load_catalog(json.dumps(data)))
