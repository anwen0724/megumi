"""Model metadata survives catalog loading and independent queries."""

import json
from dataclasses import asdict, replace

import pytest

from app.ai import create_models
from app.ai.catalog import load_catalog


def test_sampling_reasoning_and_compat_survive_catalog_and_snapshot(provider):
    data = asdict(provider.models[0])
    data["sampling_params"] = {"top_p": 0.8, "extension": {"values": [None, True, 2]}}
    data["capabilities"].update(reasoning=True, reasoning_levels={"off": None, "max": "maximum"})
    data["compat"] = {
        "supports_strict_mode": False,
        "max_tokens_field": "max_tokens",
        "thinking_format": "deepseek",
        "supports_finish_reason": False,
    }
    loaded = load_catalog(json.dumps([data]))
    models = create_models([replace(provider, models=loaded)])
    result = models.get_model("sample", "small")
    assert result.sampling_params == data["sampling_params"]
    assert result.capabilities.reasoning is True
    assert result.capabilities.reasoning_levels == {"off": None, "max": "maximum"}
    assert result.compat.supports_strict_mode is False
    assert result.compat.supports_long_cache_retention is None
    assert result.compat.max_tokens_field == "max_tokens"
    assert result.compat.thinking_format == "deepseek"
    result.sampling_params["extension"]["values"].append("external")
    assert models.get_model("sample", "small").sampling_params == data["sampling_params"]


def test_supported_levels_distinguish_defaults_null_and_extended_levels(provider):
    from app.ai import ModelCapabilities, clamp_thinking_level, get_supported_thinking_levels

    model = replace(provider.models[0], capabilities=ModelCapabilities(reasoning=True))
    assert get_supported_thinking_levels(model) == ("off", "minimal", "low", "medium", "high")
    model = replace(
        model,
        capabilities=ModelCapabilities(
            reasoning=True,
            reasoning_levels={"off": None, "low": None, "high": None, "max": "maximum"},
        ),
    )
    assert get_supported_thinking_levels(model) == ("minimal", "medium", "max")
    assert clamp_thinking_level(model, "low") == "medium"
    assert clamp_thinking_level(model, "high") == "max"
    assert clamp_thinking_level(model, "unexpected") == "minimal"
    model = replace(
        model, capabilities=ModelCapabilities(reasoning=True, reasoning_levels={"high": None})
    )
    assert clamp_thinking_level(model, "max") == "medium"
    disabled = replace(
        model, capabilities=ModelCapabilities(reasoning=False, reasoning_levels={"max": "max"})
    )
    assert get_supported_thinking_levels(disabled) == ("off",)
    assert clamp_thinking_level(disabled, "high") == "off"
    empty = replace(
        model,
        capabilities=ModelCapabilities(
            reasoning=True,
            reasoning_levels={level: None for level in ("off", "minimal", "low", "medium", "high")},
        ),
    )
    assert get_supported_thinking_levels(empty) == ()
    assert clamp_thinking_level(empty, "high") == "off"


@pytest.mark.parametrize(
    "changes",
    [
        {"sampling_params": []},
        {"sampling_params": {"top_p": float("nan")}},
        {"capabilities": {"reasoning": "yes"}},
        {"compat": {"supports_strict_mode": "yes"}},
        {"compat": {"max_tokens_field": "invalid"}},
        {"compat": {"thinking_format": "unsupported"}},
        {"compat": {"session_affinity_format": "unsupported"}},
        {"compat": {"system_role": "user"}},
    ],
)
def test_invalid_metadata_is_rejected_by_loader_and_atomic_setting(provider, changes):
    from app.ai import ConfigurationError, ModelCapabilities, ModelCompat

    data = asdict(provider.models[0])
    data.update(changes)
    with pytest.raises(ConfigurationError):
        load_catalog(json.dumps([data]))
    kwargs = dict(changes)
    if "capabilities" in kwargs:
        kwargs["capabilities"] = ModelCapabilities(**kwargs["capabilities"])
    if "compat" in kwargs:
        kwargs["compat"] = ModelCompat(**kwargs["compat"])
    models = create_models([provider])
    with pytest.raises(ConfigurationError):
        models.set_provider(replace(provider, models=[replace(provider.models[0], **kwargs)]))
    assert models.get_models() == tuple(provider.models)


def test_non_json_sampling_values_and_unknown_catalog_fields_are_rejected(provider):
    from app.ai import ConfigurationError

    for sampling in ({1: "bad-key"}, {"value": object()}, {"value": {1, 2}}):
        with pytest.raises(ConfigurationError):
            create_models(
                [replace(provider, models=[replace(provider.models[0], sampling_params=sampling)])]
            )
    data = asdict(provider.models[0])
    data["compat"]["unimplemented_option"] = True
    with pytest.raises(ConfigurationError):
        load_catalog(json.dumps([data]))
