"""Automatic model discovery is independent of an enumerated inclusion list."""

import pytest
from conftest import raw_model, rule

from app.ai.catalog import load_catalog
from app.ai.scripts.catalog_io import CatalogError, digest, encode
from app.ai.scripts.catalog_transform import generate_catalog


def snapshot(models, identity="openai"):
    data = {"id": identity, "models": models}
    return {
        "schema_version": 1,
        "source_url": "https://models.dev/api.json",
        "fetched_at": "2026-09-20T00:00:00+00:00",
        "data": data,
        "content_hash": digest(encode(data)),
    }


def test_new_models_are_discovered_and_loaded_without_a_manual_list():
    models, _, _ = generate_catalog(
        snapshot({"never-seen": raw_model("never-seen"), "old": raw_model("old")}), rule("openai")
    )
    assert [m["id"] for m in models] == ["never-seen", "old"]
    loaded = load_catalog(encode(models).decode())
    assert loaded[0].context_window == 8192
    assert loaded[0].max_output_tokens == 2048
    assert loaded[0].capabilities.tools is True
    assert loaded[0].source is None


def test_strict_tool_filter_and_exact_exclusions_report_reasons():
    candidates = {
        str(i): raw_model(str(i), tool_call=flag)
        for i, flag in enumerate([True, False, None, "true"])
    }
    candidates["missing"] = {"id": "missing"}
    candidates["blocked"] = raw_model("blocked")
    settings = rule("openai")
    settings["excluded"] = [
        {
            "model_id": "blocked",
            "reason": "unsupported endpoint",
            "source": {"url": "https://example.test/docs", "checked_at": "2026-09-20"},
        },
        {
            "model_id": "already-gone",
            "reason": "retired",
            "source": {"url": "https://example.test/docs", "checked_at": "2026-09-20"},
        },
    ]
    models, _, report = generate_catalog(snapshot(candidates), settings)
    assert [m["id"] for m in models] == ["0"]
    assert any("blocked" in item and "unsupported endpoint" in item for item in report)
    assert any("already-gone" in item and "unmatched" in item for item in report)
    assert sum("tool_call" in item for item in report) == 4


def test_another_registered_provider_uses_the_same_flow():
    models, _, _ = generate_catalog(snapshot({"a": raw_model("a")}, "third"), rule("third"))
    assert models[0]["provider"] == "third"


@pytest.mark.parametrize(
    "change,field",
    [
        ({"limit": {}}, "context_window"),
        ({"limit": {"context": True, "output": 12}}, "context_window"),
        ({"temperature": None}, "temperature"),
        ({"reasoning": None}, "reasoning"),
        ({"reasoning": True}, "reasoning"),
        ({"id": "different"}, "identity"),
    ],
)
def test_bad_candidate_fails_with_model_and_field(change, field):
    with pytest.raises(CatalogError, match=f"broken.*{field}"):
        generate_catalog(
            snapshot({"good": raw_model("good"), "broken": raw_model("broken", **change)}),
            rule("openai"),
        )


@pytest.mark.parametrize("kind", ["empty", "duplicate-exclusion"])
def test_empty_result_and_duplicate_exclusions_are_errors(kind):
    settings = rule("openai")
    data = {"a": raw_model("a", tool_call=False)}
    if kind == "duplicate-exclusion":
        data = {"a": raw_model("a")}
        exclusion = {
            "model_id": "a",
            "reason": "not applicable",
            "source": {"url": "https://example.test", "checked_at": "2026-09-20"},
        }
        settings["excluded"] = [exclusion, exclusion]
    with pytest.raises(CatalogError):
        generate_catalog(snapshot(data), settings)


@pytest.mark.parametrize(
    "efforts,expected",
    [
        (["high"], {"high": "high"}),
        (["none", "low", "high"], {"off": "none", "low": "low", "high": "high"}),
    ],
)
def test_effort_mapping_never_invents_off_or_unlisted_levels(efforts, expected):
    raw = raw_model(
        reasoning=True,
        reasoning_options=[{"type": "effort", "values": efforts}],
        modalities={"input": ["text", "image", "pdf"], "output": ["text"]},
    )
    models, _, report = generate_catalog(snapshot({"new-model": raw}), rule("openai"))
    assert models[0]["capabilities"]["reasoning_levels"] == expected
    assert models[0]["capabilities"]["input_modalities"] == ["text", "image"]
    assert any("pdf" in item for item in report)


def test_exact_prices_unknown_zero_and_currency_are_preserved():
    from decimal import Decimal

    raw = raw_model(cost={"input": Decimal("0.123456789012345678901"), "output": 0})
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), rule("openai"))
    loaded = load_catalog(encode(models).decode())[0]
    assert loaded.pricing.input == Decimal("0.123456789012345678901")
    assert loaded.pricing.output == 0
    assert loaded.pricing.cache_read is None
    settings = rule("openai")
    settings["currency"] = "CNY"
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), settings)
    loaded = load_catalog(encode(models).decode())[0]
    assert loaded.pricing.currency == "CNY" and loaded.pricing.input is None


def test_verified_toggle_and_alias_rules_are_distinct_from_effort_list():
    settings = rule("openai")
    settings["toggle_map"] = {"off": "disabled"}
    settings["reasoning_aliases"] = {"minimal": "low", "medium": "high"}
    raw = raw_model(
        reasoning=True,
        reasoning_options=[{"type": "toggle"}, {"type": "effort", "values": ["low", "high"]}],
    )
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), settings)
    assert models[0]["capabilities"]["reasoning_levels"] == {
        "off": "disabled",
        "minimal": "low",
        "low": "low",
        "medium": "high",
        "high": "high",
    }


def test_service_mode_prices_are_not_lost_or_assumed_standard():
    raw = raw_model(
        experimental={
            "modes": {
                "fast": {
                    "cost": {"input": 4, "output": 8},
                    "provider": {"body": {"service_tier": "priority"}},
                }
            }
        }
    )
    models, _, _ = generate_catalog(snapshot({"new-model": raw}), rule("openai"))
    assert any(
        t["input"] == "4" and "priority" in t["condition"] for t in models[0]["pricing"]["tiers"]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("schema_version", True),
        ("source_url", "not-a-url"),
        ("fetched_at", "not-a-date"),
    ],
)
def test_source_metadata_is_validated_before_generation(field, value):
    data = snapshot({"new-model": raw_model()})
    data[field] = value
    with pytest.raises(CatalogError):
        generate_catalog(data, rule("openai"))
