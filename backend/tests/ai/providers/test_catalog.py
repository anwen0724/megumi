"""Catalog validation rejects a whole invalid publication."""

from dataclasses import replace

import pytest

from app.ai.models import create_models
from app.ai.provider import Provider


@pytest.mark.parametrize("invalid", ["duplicate", "wrong-provider", "wrong-api"])
def test_bad_directory_never_partially_replaces_or_registers(
    provider: Provider, invalid: str
) -> None:
    model = provider.models[0]
    bad = {
        "duplicate": model,
        "wrong-provider": replace(model, provider="other"),
        "wrong-api": replace(model, api="unknown"),
    }[invalid]
    replacement = replace(provider, models=[model, bad])
    models = create_models([provider])
    with pytest.raises(ValueError):
        models.set_provider(replacement)
    assert [(m.id, m.provider) for m in models.get_models()] == [("small", "sample")]
    empty = create_models()
    with pytest.raises(ValueError):
        empty.set_provider(replacement)
    assert empty.get_models() == ()


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", ""),
        ("id", "  "),
        ("api", ""),
        ("api", "unknown"),
        ("base_url", "/relative"),
        ("base_url", "ftp://example.test"),
        ("base_url", "https://user:secret@example.test"),
        ("base_url", "https://example.test?api_key=secret"),
        ("headers", {"X-Trace": "bad\r\nInjected: yes"}),
        ("headers", {"Bad\nName": "value"}),
    ],
)
def test_invalid_provider_configuration_is_rejected(
    provider: Provider, field: str, value: object
) -> None:
    with pytest.raises(ValueError):
        create_models([replace(provider, **{field: value})])


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", ""),
        ("context_window", 0),
        ("context_window", -1),
        ("context_window", True),
        ("max_output_tokens", 0),
        ("max_output_tokens", 1.5),
        ("base_url", "https://user:secret@example.test"),
        ("headers", {"X-Test": "bad\nvalue"}),
    ],
)
def test_invalid_model_configuration_is_rejected(
    provider: Provider, field: str, value: object
) -> None:
    with pytest.raises(ValueError):
        create_models([replace(provider, models=[replace(provider.models[0], **{field: value})])])


def test_local_gateway_and_unknown_zero_decimal_prices_preserve_meaning(provider: Provider) -> None:
    from decimal import Decimal

    from app.ai.model import CatalogSource, ModelCapabilities, Pricing

    definition = replace(
        provider.models[0],
        base_url="http://localhost:8080/v1",
        pricing=Pricing(input=None, output=Decimal("0"), cache_read=Decimal("0.125")),
        capabilities=ModelCapabilities(
            tools=True, reasoning_levels={"low": "low"}, temperature=False
        ),
        source=CatalogSource(url="https://example.test/models", checked_at="2026-09-20"),
    )
    model = create_models([replace(provider, models=[definition])]).get_model("sample", "small")
    assert model.pricing.input is None
    assert model.pricing.output == Decimal("0")
    assert model.pricing.cache_read == Decimal("0.125")
    assert model.capabilities.tools and not model.capabilities.temperature
    assert model.capabilities.reasoning_levels == {"low": "low"}
    assert model.source.checked_at == "2026-09-20"


@pytest.mark.parametrize(
    "kind", ["negative-price", "nan-price", "bad-unit", "bad-modality", "bad-reasoning"]
)
def test_invalid_price_or_capability_data_is_rejected(provider: Provider, kind: str) -> None:
    from decimal import Decimal

    from app.ai.model import ModelCapabilities, Pricing

    changes = {
        "negative-price": {"pricing": Pricing(input=Decimal("-1"))},
        "nan-price": {"pricing": Pricing(output=Decimal("NaN"))},
        "bad-unit": {"pricing": Pricing(unit_tokens=0)},
        "bad-modality": {"capabilities": ModelCapabilities(input_modalities=("unknown",))},
        "bad-reasoning": {"capabilities": ModelCapabilities(reasoning_levels={"high": ""})},
    }[kind]
    with pytest.raises(ValueError):
        create_models([replace(provider, models=[replace(provider.models[0], **changes)])])


@pytest.mark.parametrize("mapping", [{"high": 1}, {"unknown": None}])
def test_malformed_reasoning_mapping_is_a_configuration_error_and_preserves_state(
    provider, mapping
):
    from app.ai.errors import ConfigurationError
    from app.ai.model import ModelCapabilities

    models = create_models([provider])
    bad = replace(
        provider.models[0],
        capabilities=ModelCapabilities(reasoning_levels=mapping),
    )
    with pytest.raises(ConfigurationError):
        models.set_provider(replace(provider, models=[bad]))
    assert models.get_models() == (provider.models[0],)
