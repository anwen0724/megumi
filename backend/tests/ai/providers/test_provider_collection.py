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
