"""Model collection behavior through its public interface."""

from app.ai.models import create_models
from app.ai.provider import Provider


def test_known_model_is_found(provider: Provider) -> None:
    models = create_models([provider])
    result = models.get_model("sample", "small")
    assert result is not None
    assert (result.id, result.provider, result.context_window) == ("small", "sample", 4096)


def test_missing_model_is_a_normal_query_result(provider: Provider) -> None:
    models = create_models([provider])
    assert models.get_model("absent", "small") is None
    assert models.get_model("sample", "absent") is None


def test_lists_and_same_named_models_are_provider_qualified(provider: Provider) -> None:
    from dataclasses import replace

    other = replace(provider, id="other", models=[replace(provider.models[0], provider="other")])
    models = create_models([provider, other])
    assert models.get_model("other", "small").provider == "other"
    assert {(m.provider, m.id) for m in models.get_models()} == {
        ("sample", "small"),
        ("other", "small"),
    }
    assert [m.provider for m in models.get_models("sample")] == ["sample"]
    assert models.get_models("absent") == ()
    assert create_models().get_models() == ()


def test_setting_replaces_the_whole_provider_without_affecting_others(provider: Provider) -> None:
    from dataclasses import replace

    other = replace(provider, id="other", models=[replace(provider.models[0], provider="other")])
    models = create_models([other])
    models.set_provider(provider)
    assert models.get_model("sample", "small") is not None
    replacement = replace(
        provider,
        base_url="https://new.test/v1",
        headers={"X-Region": "new"},
        models=[replace(provider.models[0], id="large", max_output_tokens=1024)],
    )
    models.set_provider(replacement)
    assert models.get_model("sample", "small") is None
    assert models.get_model("sample", "large").max_output_tokens == 1024
    assert models.get_model("other", "small") is not None
    assert len(models.get_models()) == 2


def test_original_inputs_and_returned_models_cannot_mutate_collection(provider: Provider) -> None:
    from dataclasses import replace

    from app.ai.model import ModelCapabilities

    levels = {"low": "low"}
    headers = {"X-Trace": "original"}
    original = replace(
        provider.models[0], headers=headers, capabilities=ModelCapabilities(reasoning_levels=levels)
    )
    inputs = [original]
    models = create_models([replace(provider, models=inputs)])
    headers["X-Trace"] = "changed"
    levels["low"] = "changed"
    inputs.clear()
    result = models.get_model("sample", "small")
    assert result is not None
    assert result.headers == {"X-Trace": "original"}
    assert result.capabilities.reasoning_levels == {"low": "low"}
    result.headers["X-Trace"] = "external"
    models.get_models()[0].capabilities.reasoning_levels["low"] = "external"
    assert models.get_model("sample", "small").headers == {"X-Trace": "original"}
    assert models.get_model("sample", "small").capabilities.reasoning_levels == {"low": "low"}
