"""Corrections and reviews remain explicit and tied to their original values."""

from copy import deepcopy

import pytest
from conftest import raw_model, rule
from test_generate import snapshot

from app.ai.catalog_generation import CatalogError
from app.ai.catalog_generation.generate import generate_catalog

SOURCE = {"url": "https://example.test/official", "checked_at": "2026-09-20"}


def patch(path, expected, replacement, identity="new-model"):
    return {
        "model_id": identity,
        "path": path,
        "expected": expected,
        "replacement": replacement,
        "source": SOURCE,
        "reason": "official correction",
    }


def definition(identity="extra"):
    return {
        "id": identity,
        "name": "Extra model",
        "provider": "openai",
        "api": "openai-responses",
        "context_window": 4096,
        "max_output_tokens": 512,
        "capabilities": {
            "tools": True,
            "input_modalities": ["text"],
            "temperature": True,
            "reasoning_levels": {},
        },
        "pricing": {
            "currency": "USD",
            "unit_tokens": 1000000,
            "tiers": [],
            "input": None,
            "output": None,
            "cache_read": None,
            "cache_write": None,
        },
        "source": SOURCE,
    }


def test_supplement_and_guarded_nested_correction_preserve_other_facts():
    settings = rule("openai")
    settings["supplements"] = [
        {"model": definition(), "source": SOURCE, "reason": "missing upstream"}
    ]
    settings["patches"] = [
        patch("max_output_tokens", 2048, 1024),
        patch("capabilities.input_modalities", ["text"], ["text", "image"]),
    ]
    original = snapshot({"new-model": raw_model()})
    before = deepcopy(original)
    models, traces, _ = generate_catalog(original, settings)
    assert [m["id"] for m in models] == ["extra", "new-model"]
    assert models[1]["max_output_tokens"] == 1024
    assert models[1]["context_window"] == 8192
    assert models[1]["capabilities"]["input_modalities"] == ["text", "image"]
    assert traces["new-model"]["fields"]["max_output_tokens"]["kind"] == "patch"
    assert traces["extra"]["fields"]["name"]["kind"] == "supplement"
    assert original == before


@pytest.mark.parametrize(
    "kind",
    [
        "stale",
        "missing-target",
        "filtered-target",
        "unknown-path",
        "identity-change",
        "duplicate-patch",
        "overlapping-patch",
        "supplement-collision",
        "excluded-supplement",
        "non-tool-supplement",
        "no-evidence",
    ],
)
def test_invalid_maintenance_fails_instead_of_silently_ignoring(kind):
    settings = rule("openai")
    raw = raw_model()
    settings["patches"] = [patch("max_output_tokens", 2048, 1024)]
    if kind == "stale":
        raw["limit"]["output"] = 4096
    elif kind == "missing-target":
        settings["patches"][0]["model_id"] = "gone"
    elif kind == "filtered-target":
        raw["tool_call"] = False
    elif kind == "unknown-path":
        settings["patches"][0]["path"] = "unknown.field"
    elif kind == "identity-change":
        settings["patches"] = [patch("id", "new-model", "other")]
    elif kind == "duplicate-patch":
        settings["patches"] *= 2
    elif kind == "overlapping-patch":
        settings["patches"] = [
            patch("capabilities", {}, {}),
            patch("capabilities.temperature", True, False),
        ]
    elif kind == "supplement-collision":
        settings["supplements"] = [
            {"model": definition("new-model"), "source": SOURCE, "reason": "x"}
        ]
    elif kind == "excluded-supplement":
        settings["supplements"] = [{"model": definition(), "source": SOURCE, "reason": "x"}]
        settings["excluded"] = [{"model_id": "extra", "source": SOURCE, "reason": "x"}]
    elif kind == "non-tool-supplement":
        extra = definition()
        extra["capabilities"]["tools"] = False
        settings["supplements"] = [{"model": extra, "source": SOURCE, "reason": "x"}]
    elif kind == "no-evidence":
        settings["patches"][0]["source"] = {}
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw}), settings)


def test_missing_is_not_null_and_already_correct_is_reported():
    raw = raw_model()
    del raw["limit"]["output"]
    settings = rule("openai")
    settings["patches"] = [patch("max_output_tokens", {"missing": True}, 512)]
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), settings)
    assert models[0]["max_output_tokens"] == 512
    raw["limit"]["output"] = None
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw}), settings)
    raw["limit"]["output"] = 512
    _, _, report = generate_catalog(snapshot({"new-model": raw}), settings)
    assert any("redundant" in item for item in report)


def test_reviews_apply_only_to_values_that_still_match():
    settings = rule("openai")
    settings["reviews"] = [
        {
            "model_id": "new-model",
            "source": SOURCE,
            "reason": "review",
            "fields": {"context_window": 8192, "max_output_tokens": 999},
        }
    ]
    models, traces, _ = generate_catalog(snapshot({"new-model": raw_model()}), settings)
    record = traces["new-model"]["reviews"][0]
    assert record["matched"] == ["context_window"]
    assert record["stale"] == ["max_output_tokens"]
    assert traces["new-model"]["fields"]["context_window"]["verified"] is True
    assert not traces["new-model"]["fields"]["max_output_tokens"].get("verified", False)
    assert models[0]["source"] == SOURCE


def test_conditional_prices_keep_context_threshold_and_service_scope():
    raw = raw_model(
        cost={
            "input": 1,
            "output": 2,
            "tiers": [{"tier": {"type": "context", "size": 4096}, "input": 3, "output": 4}],
        }
    )
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), rule("openai"))
    model = models[0]
    assert model["context_window"] == 8192
    assert model["pricing"]["input"] is None
    tiers = model["pricing"]["tiers"]
    assert tiers[0]["input"] == "1" and "4096" in tiers[0]["condition"]
    assert tiers[1]["input"] == "3" and "> 4096" in tiers[1]["condition"]
    assert all("Standard" in tier["condition"] for tier in tiers)


@pytest.mark.parametrize(
    "cost",
    [
        {"input": -1},
        {"output": True},
        {"tiers": [{"tier": {"type": "mystery", "size": 10}, "input": 1}]},
        {"unknown_condition": {"input": 2}},
    ],
)
def test_uninterpretable_price_facts_fail(cost):
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw_model(cost=cost)}), rule("openai"))


def test_whole_cny_price_correction_keeps_time_conditions():
    settings = rule("openai")
    expected = {
        "currency": "USD",
        "unit_tokens": 1000000,
        "input": "1",
        "output": "2",
        "cache_read": None,
        "cache_write": None,
        "tiers": [],
    }
    corrected = {
        "currency": "CNY",
        "unit_tokens": 1000000,
        "input": None,
        "output": None,
        "cache_read": None,
        "cache_write": None,
        "tiers": [
            {
                "condition": "Asia/Shanghai workdays 08:00-24:00 excluding holidays",
                "input": "1.2",
                "output": "2.4",
                "cache_read": None,
                "cache_write": None,
            }
        ],
    }
    settings["patches"] = [patch("pricing", expected, corrected)]
    models, _, _ = generate_catalog(snapshot({"new-model": raw_model()}), settings)
    assert models[0]["pricing"] == corrected
    settings["patches"] = [patch("pricing.currency", "USD", "CNY")]
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw_model()}), settings)


@pytest.mark.parametrize(
    "remove",
    [
        "pricing",
        "capabilities.input_modalities",
        "capabilities.reasoning_levels",
    ],
)
def test_full_supplements_cannot_use_runtime_defaults_for_missing_facts(remove):
    settings = rule("openai")
    extra = definition()
    parent = extra
    parts = remove.split(".")
    for key in parts[:-1]:
        parent = parent[key]
    del parent[parts[-1]]
    settings["supplements"] = [{"model": extra, "source": SOURCE, "reason": "extra"}]
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw_model()}), settings)


def test_field_provenance_distinguishes_rule_decisions_from_upstream_facts():
    from app.ai.catalog_generation.generate import fields

    settings = rule("openai")
    settings["patches"] = [patch("max_output_tokens", 2048, 512)]
    models, traces, _ = generate_catalog(snapshot({"new-model": raw_model()}), settings)
    recorded = traces["new-model"]["fields"]
    assert recorded["api"]["kind"] == "rule"
    assert recorded["context_window"]["upstream_path"] == "limit.context"
    assert set(recorded) == set(fields(models[0]))
    for path, value in fields(models[0]).items():
        assert recorded[path]["value"] == value


def test_boolean_replacement_cannot_be_mistaken_for_a_redundant_integer():
    settings = rule("openai")
    settings["patches"] = [patch("max_output_tokens", 2048, True)]
    raw = raw_model(limit={"context": 8192, "output": 1})
    with pytest.raises(CatalogError):
        generate_catalog(snapshot({"new-model": raw}), settings)
